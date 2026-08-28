from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from app.db.clickhouse import get_clickhouse_client
from app.db.postgres import get_pool
from app.models.schemas import QuietMember

router = APIRouter(prefix="/insights", tags=["insights"])


def _sort_key(member: QuietMember) -> tuple[int, int]:
    if member.days_since_check_in is None:
        return (0, 0)
    return (1, -member.days_since_check_in)


@router.get("/quiet-members", response_model=list[QuietMember])
async def quiet_members(
    days: int = Query(default=14, ge=1, description="Flag members with no check-in in this many days"),
    organizer_id: Optional[int] = Query(default=None),
) -> list[QuietMember]:
    pool = await get_pool()
    if organizer_id is not None:
        member_rows = await pool.fetch(
            "SELECT id, name, organizer_id, group_name FROM members WHERE organizer_id = $1 ORDER BY id",
            organizer_id,
        )
    else:
        member_rows = await pool.fetch(
            "SELECT id, name, organizer_id, group_name FROM members ORDER BY id"
        )

    client = get_clickhouse_client()
    result = client.query(
        """
        SELECT member_id, max(event_time) AS last_check_in
        FROM events
        WHERE event_type = 'check_in'
        GROUP BY member_id
        """
    )
    last_check_ins = {row[0]: row[1] for row in result.result_rows}

    now = datetime.now(timezone.utc)
    quiet: list[QuietMember] = []
    for row in member_rows:
        last_check_in = last_check_ins.get(row["id"])
        days_since: Optional[int] = None
        if last_check_in is not None:
            last_check_in = last_check_in.replace(tzinfo=timezone.utc)
            days_since = (now - last_check_in).days

        if last_check_in is None or days_since >= days:
            quiet.append(
                QuietMember(
                    member_id=row["id"],
                    name=row["name"],
                    organizer_id=row["organizer_id"],
                    group_name=row["group_name"],
                    last_check_in=last_check_in,
                    days_since_check_in=days_since,
                )
            )

    quiet.sort(key=_sort_key)
    return quiet
