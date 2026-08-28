from fastapi import APIRouter, HTTPException

from app.db.postgres import get_pool
from app.models.schemas import Teacher, TeacherCreate

router = APIRouter(prefix="/teachers", tags=["teachers"])


@router.post("", response_model=Teacher, status_code=201)
async def create_teacher(payload: TeacherCreate) -> Teacher:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO teachers (name, email, role)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, role, created_at
        """,
        payload.name,
        payload.email,
        payload.role,
    )
    return Teacher(**dict(row))


@router.get("", response_model=list[Teacher])
async def list_teachers() -> list[Teacher]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, email, role, created_at FROM teachers ORDER BY id"
    )
    return [Teacher(**dict(row)) for row in rows]


@router.get("/{teacher_id}", response_model=Teacher)
async def get_teacher(teacher_id: int) -> Teacher:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, email, role, created_at FROM teachers WHERE id = $1",
        teacher_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return Teacher(**dict(row))
