import json

from fastapi import APIRouter, Depends, HTTPException

from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.dependencies import get_current_teacher
from app.models.schemas import EventIn, Teacher

router = APIRouter(prefix="/events", tags=["events"])

EVENT_TYPE = "reading_assessment"


async def _require_own_student(student_id: int, teacher_id: int) -> None:
    pool = await get_pool()
    owner_id = await pool.fetchval("SELECT teacher_id FROM students WHERE id = $1", student_id)
    # 404 either way — a teacher probing another teacher's student id
    # shouldn't be able to tell it exists from the response.
    if owner_id is None or owner_id != teacher_id:
        raise HTTPException(status_code=404, detail="Student not found")


@router.post("", status_code=201)
async def create_event(
    payload: EventIn, current_teacher: Teacher = Depends(get_current_teacher)
) -> dict[str, str]:
    await _require_own_student(payload.student_id, current_teacher.id)

    metadata = json.dumps(
        {"accuracy_pct": payload.accuracy_pct, "error_tags": payload.error_tags}
    )

    client = get_clickhouse_client()
    client.insert(
        "events",
        [[EVENT_TYPE, payload.student_id, current_teacher.id, payload.fluency_score, metadata]],
        column_names=["event_type", "student_id", "teacher_id", "value", "metadata"],
    )
    return {"status": "recorded"}


@router.get("/students/{student_id}")
async def list_student_events(
    student_id: int, current_teacher: Teacher = Depends(get_current_teacher)
) -> list[dict]:
    await _require_own_student(student_id, current_teacher.id)

    client = get_clickhouse_client()
    result = client.query(
        """
        SELECT event_id, event_type, event_time, value, metadata
        FROM events
        WHERE student_id = {student_id:Int32}
        ORDER BY event_time DESC
        """,
        parameters={"student_id": student_id},
    )
    return [dict(zip(result.column_names, row)) for row in result.result_rows]
