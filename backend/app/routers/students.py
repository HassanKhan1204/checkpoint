from fastapi import APIRouter, Depends, HTTPException

from app.db.postgres import get_pool
from app.dependencies import get_current_teacher
from app.models.schemas import Student, StudentCreate, StudentUpdate, Teacher

router = APIRouter(prefix="/students", tags=["students"])

_SELECT_FIELDS = "id, teacher_id, name, group_name, contact, notes, parent_email, created_at"


@router.post("", response_model=Student, status_code=201)
async def create_student(
    payload: StudentCreate, current_teacher: Teacher = Depends(get_current_teacher)
) -> Student:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        INSERT INTO students (teacher_id, name, group_name, contact, notes, parent_email)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {_SELECT_FIELDS}
        """,
        current_teacher.id,
        payload.name,
        payload.group_name,
        payload.contact,
        payload.notes,
        payload.parent_email,
    )
    return Student(**dict(row))


@router.get("", response_model=list[Student])
async def list_students(current_teacher: Teacher = Depends(get_current_teacher)) -> list[Student]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_SELECT_FIELDS} FROM students WHERE teacher_id = $1 ORDER BY id",
        current_teacher.id,
    )
    return [Student(**dict(row)) for row in rows]


@router.get("/{student_id}", response_model=Student)
async def get_student(
    student_id: int, current_teacher: Teacher = Depends(get_current_teacher)
) -> Student:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"SELECT {_SELECT_FIELDS} FROM students WHERE id = $1 AND teacher_id = $2",
        student_id,
        current_teacher.id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return Student(**dict(row))


@router.put("/{student_id}", response_model=Student)
async def update_student(
    student_id: int,
    payload: StudentUpdate,
    current_teacher: Teacher = Depends(get_current_teacher),
) -> Student:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        UPDATE students
        SET name = $1, group_name = $2, contact = $3, notes = $4, parent_email = $5
        WHERE id = $6 AND teacher_id = $7
        RETURNING {_SELECT_FIELDS}
        """,
        payload.name,
        payload.group_name,
        payload.contact,
        payload.notes,
        payload.parent_email,
        student_id,
        current_teacher.id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return Student(**dict(row))


@router.delete("/{student_id}")
async def delete_student(
    student_id: int, current_teacher: Teacher = Depends(get_current_teacher)
) -> dict[str, str]:
    pool = await get_pool()
    # Postgres record only — historical ClickHouse events for this student
    # are left as orphaned data, not cascade-deleted (out of scope for today).
    result = await pool.execute(
        "DELETE FROM students WHERE id = $1 AND teacher_id = $2", student_id, current_teacher.id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Student not found")
    return {"status": "deleted"}
