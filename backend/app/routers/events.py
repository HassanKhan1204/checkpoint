from fastapi import APIRouter, HTTPException

from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.models.schemas import EventIn

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", status_code=201)
async def create_event(payload: EventIn) -> dict[str, str]:
    pool = await get_pool()
    student_exists = await pool.fetchval(
        "SELECT 1 FROM students WHERE id = $1", payload.student_id
    )
    if not student_exists:
        raise HTTPException(status_code=404, detail="Student not found")

    client = get_clickhouse_client()
    client.insert(
        "events",
        [[payload.event_type, payload.student_id, payload.teacher_id, payload.value, payload.metadata or ""]],
        column_names=["event_type", "student_id", "teacher_id", "value", "metadata"],
    )
    return {"status": "recorded"}


@router.get("/students/{student_id}")
async def list_student_events(student_id: int) -> list[dict]:
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
