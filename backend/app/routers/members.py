from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db.postgres import get_pool
from app.models.schemas import Member, MemberCreate

router = APIRouter(prefix="/members", tags=["members"])

_SELECT_FIELDS = "id, organizer_id, name, group_name, contact, notes, created_at"


@router.post("", response_model=Member, status_code=201)
async def create_member(payload: MemberCreate) -> Member:
    pool = await get_pool()
    organizer_exists = await pool.fetchval(
        "SELECT 1 FROM organizers WHERE id = $1", payload.organizer_id
    )
    if not organizer_exists:
        raise HTTPException(status_code=404, detail="Organizer not found")

    row = await pool.fetchrow(
        f"""
        INSERT INTO members (organizer_id, name, group_name, contact, notes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_SELECT_FIELDS}
        """,
        payload.organizer_id,
        payload.name,
        payload.group_name,
        payload.contact,
        payload.notes,
    )
    return Member(**dict(row))


@router.get("", response_model=list[Member])
async def list_members(organizer_id: Optional[int] = Query(default=None)) -> list[Member]:
    pool = await get_pool()
    if organizer_id is not None:
        rows = await pool.fetch(
            f"SELECT {_SELECT_FIELDS} FROM members WHERE organizer_id = $1 ORDER BY id",
            organizer_id,
        )
    else:
        rows = await pool.fetch(f"SELECT {_SELECT_FIELDS} FROM members ORDER BY id")
    return [Member(**dict(row)) for row in rows]


@router.get("/{member_id}", response_model=Member)
async def get_member(member_id: int) -> Member:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"SELECT {_SELECT_FIELDS} FROM members WHERE id = $1", member_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return Member(**dict(row))
