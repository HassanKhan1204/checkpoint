from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db.postgres import get_pool
from app.models.schemas import Student, StudentCreate

router = APIRouter(prefix="/students", tags=["students"])

_SELECT_FIELDS = "id, teacher_id, name, group_name, contact, notes, created_at"


@router.post("", response_model=Student, status_code=201)
async def create_student(payload: StudentCreate) -> Student:
    pool = await get_pool()
    teacher_exists = await pool.fetchval(
        "SELECT 1 FROM teachers WHERE id = $1", payload.teacher_id
    )
    if not teacher_exists:
        raise HTTPException(status_code=404, detail="Teacher not found")

    row = await pool.fetchrow(
        f"""
        INSERT INTO students (teacher_id, name, group_name, contact, notes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_SELECT_FIELDS}
        """,
        payload.teacher_id,
        payload.name,
        payload.group_name,
        payload.contact,
        payload.notes,
    )
    return Student(**dict(row))


@router.get("", response_model=list[Student])
async def list_students(teacher_id: Optional[int] = Query(default=None)) -> list[Student]:
    pool = await get_pool()
    if teacher_id is not None:
        rows = await pool.fetch(
            f"SELECT {_SELECT_FIELDS} FROM students WHERE teacher_id = $1 ORDER BY id",
            teacher_id,
        )
    else:
        rows = await pool.fetch(f"SELECT {_SELECT_FIELDS} FROM students ORDER BY id")
    return [Student(**dict(row)) for row in rows]


@router.get("/{student_id}", response_model=Student)
async def get_student(student_id: int) -> Student:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"SELECT {_SELECT_FIELDS} FROM students WHERE id = $1", student_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return Student(**dict(row))
