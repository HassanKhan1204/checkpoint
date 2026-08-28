from fastapi import APIRouter, HTTPException

from app.db.postgres import get_pool
from app.models.schemas import Organizer, OrganizerCreate

router = APIRouter(prefix="/organizers", tags=["organizers"])


@router.post("", response_model=Organizer, status_code=201)
async def create_organizer(payload: OrganizerCreate) -> Organizer:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO organizers (name, email, role)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, role, created_at
        """,
        payload.name,
        payload.email,
        payload.role,
    )
    return Organizer(**dict(row))


@router.get("", response_model=list[Organizer])
async def list_organizers() -> list[Organizer]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, email, role, created_at FROM organizers ORDER BY id"
    )
    return [Organizer(**dict(row)) for row in rows]


@router.get("/{organizer_id}", response_model=Organizer)
async def get_organizer(organizer_id: int) -> Organizer:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, email, role, created_at FROM organizers WHERE id = $1",
        organizer_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return Organizer(**dict(row))
