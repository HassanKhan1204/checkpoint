import asyncio
import json
from datetime import timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.models.schemas import AssessmentPoint, DecliningStudent, OutreachDraft
from app.services.outreach import draft_outreach_note

router = APIRouter(prefix="/insights", tags=["insights"])

HISTORY_SIZE = 3


def _sort_key(student: DecliningStudent) -> tuple[int, float]:
    if student.status == "insufficient_data":
        return (1, len(student.history))
    # Most recent first (index -1 after we've reversed to chronological order).
    drop = student.average_previous_score - student.history[-1].fluency_score
    return (0, -drop)


async def _get_declining_students(teacher_id: Optional[int]) -> list[DecliningStudent]:
    pool = await get_pool()
    if teacher_id is not None:
        student_rows = await pool.fetch(
            "SELECT id, name, teacher_id, group_name FROM students WHERE teacher_id = $1 ORDER BY id",
            teacher_id,
        )
    else:
        student_rows = await pool.fetch(
            "SELECT id, name, teacher_id, group_name FROM students ORDER BY id"
        )
    students_by_id = {row["id"]: row for row in student_rows}

    client = get_clickhouse_client()
    result = client.query(
        """
        SELECT student_id, event_time, value AS fluency_score, metadata
        FROM events
        WHERE event_type = 'reading_assessment'
        ORDER BY student_id, event_time DESC
        """
    )

    # Rows are grouped by student_id (primary sort key) and, within each group,
    # most-recent-first — so capping each group at HISTORY_SIZE keeps exactly
    # the last 3 assessments per student.
    recent_by_student: dict[int, list[AssessmentPoint]] = {}
    for student_id, event_time, fluency_score, metadata in result.result_rows:
        if student_id not in students_by_id:
            continue
        points = recent_by_student.setdefault(student_id, [])
        if len(points) >= HISTORY_SIZE:
            continue
        parsed = json.loads(metadata) if metadata else {}
        points.append(
            AssessmentPoint(
                event_time=event_time.replace(tzinfo=timezone.utc),
                fluency_score=fluency_score,
                accuracy_pct=parsed.get("accuracy_pct", 0.0),
                error_tags=parsed.get("error_tags", []),
            )
        )

    flagged: list[DecliningStudent] = []
    for student_id, row in students_by_id.items():
        recent = recent_by_student.get(student_id, [])  # most-recent-first
        history = list(reversed(recent))  # chronological, oldest first

        if len(recent) < HISTORY_SIZE:
            flagged.append(
                DecliningStudent(
                    student_id=student_id,
                    name=row["name"],
                    teacher_id=row["teacher_id"],
                    group_name=row["group_name"],
                    status="insufficient_data",
                    history=history,
                )
            )
            continue

        most_recent, *previous_two = recent
        average_previous = sum(p.fluency_score for p in previous_two) / len(previous_two)
        if most_recent.fluency_score < average_previous:
            flagged.append(
                DecliningStudent(
                    student_id=student_id,
                    name=row["name"],
                    teacher_id=row["teacher_id"],
                    group_name=row["group_name"],
                    status="declining",
                    history=history,
                    average_previous_score=average_previous,
                )
            )

    flagged.sort(key=_sort_key)
    return flagged


@router.get("/declining-students", response_model=list[DecliningStudent])
async def declining_students(
    teacher_id: Optional[int] = Query(default=None),
) -> list[DecliningStudent]:
    return await _get_declining_students(teacher_id)


@router.get("/declining-students/drafts", response_model=list[OutreachDraft])
async def declining_students_drafts(
    teacher_id: Optional[int] = Query(default=None),
) -> list[OutreachDraft]:
    students = await _get_declining_students(teacher_id)
    to_draft = [s for s in students if s.status == "declining"]

    if to_draft:
        if not settings.anthropic_api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY is not configured — set it in backend/.env",
            )
        drafts = await asyncio.gather(*(draft_outreach_note(s) for s in to_draft))
    else:
        drafts = []
    draft_by_id = dict(zip((s.student_id for s in to_draft), drafts))

    return [
        OutreachDraft(**s.model_dump(), draft=draft_by_id.get(s.student_id))
        for s in students
    ]
