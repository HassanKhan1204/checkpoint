from fastapi import APIRouter, HTTPException

from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.models.schemas import EventIn

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", status_code=201)
async def create_event(payload: EventIn) -> dict[str, str]:
    pool = await get_pool()
    member_exists = await pool.fetchval(
        "SELECT 1 FROM members WHERE id = $1", payload.member_id
    )
    if not member_exists:
        raise HTTPException(status_code=404, detail="Member not found")

    client = get_clickhouse_client()
    client.insert(
        "events",
        [[payload.event_type, payload.member_id, payload.organizer_id, payload.value, payload.metadata or ""]],
        column_names=["event_type", "member_id", "organizer_id", "value", "metadata"],
    )
    return {"status": "recorded"}


@router.get("/members/{member_id}")
async def list_member_events(member_id: int) -> list[dict]:
    client = get_clickhouse_client()
    result = client.query(
        """
        SELECT event_id, event_type, event_time, value, metadata
        FROM events
        WHERE member_id = {member_id:Int32}
        ORDER BY event_time DESC
        """,
        parameters={"member_id": member_id},
    )
    return [dict(zip(result.column_names, row)) for row in result.result_rows]
