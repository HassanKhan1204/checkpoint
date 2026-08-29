import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import settings
from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.models.schemas import OutreachDraft, QuietStudent
from app.services.outreach import draft_outreach_note

router = APIRouter(prefix="/insights", tags=["insights"])


def _sort_key(student: QuietStudent) -> tuple[int, int]:
    if student.days_since_check_in is None:
        return (0, 0)
    return (1, -student.days_since_check_in)


async def _get_quiet_students(days: int, teacher_id: Optional[int]) -> list[QuietStudent]:
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

    client = get_clickhouse_client()
    result = client.query(
        """
        SELECT student_id, max(event_time) AS last_check_in
        FROM events
        WHERE event_type = 'reading_assessment'
        GROUP BY student_id
        """
    )
    last_check_ins = {row[0]: row[1] for row in result.result_rows}

    now = datetime.now(timezone.utc)
    quiet: list[QuietStudent] = []
    for row in student_rows:
        last_check_in = last_check_ins.get(row["id"])
        days_since: Optional[int] = None
        if last_check_in is not None:
            last_check_in = last_check_in.replace(tzinfo=timezone.utc)
            days_since = (now - last_check_in).days

        if last_check_in is None or days_since >= days:
            quiet.append(
                QuietStudent(
                    student_id=row["id"],
                    name=row["name"],
                    teacher_id=row["teacher_id"],
                    group_name=row["group_name"],
                    last_check_in=last_check_in,
                    days_since_check_in=days_since,
                )
            )

    quiet.sort(key=_sort_key)
    return quiet


@router.get("/quiet-students", response_model=list[QuietStudent])
async def quiet_students(
    days: int = Query(default=14, ge=1, description="Flag students with no check-in in this many days"),
    teacher_id: Optional[int] = Query(default=None),
) -> list[QuietStudent]:
    return await _get_quiet_students(days, teacher_id)


@router.get("/quiet-students/drafts", response_model=list[OutreachDraft])
async def quiet_students_drafts(
    days: int = Query(default=14, ge=1, description="Flag students with no check-in in this many days"),
    teacher_id: Optional[int] = Query(default=None),
) -> list[OutreachDraft]:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured — set it in backend/.env",
        )
    quiet = await _get_quiet_students(days, teacher_id)
    drafts = await asyncio.gather(*(draft_outreach_note(student) for student in quiet))
    return [
        OutreachDraft(**student.model_dump(), draft=draft)
        for student, draft in zip(quiet, drafts)
    ]
