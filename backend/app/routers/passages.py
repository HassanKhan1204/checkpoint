from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.db.postgres import get_pool
from app.models.schemas import Passage, PassageCreate

router = APIRouter(prefix="/passages", tags=["passages"])

_SELECT_FIELDS = "id, grade_level, text, created_at"


@router.post("", response_model=Passage, status_code=201)
async def create_passage(payload: PassageCreate) -> Passage:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        INSERT INTO passages (grade_level, text)
        VALUES ($1, $2)
        RETURNING {_SELECT_FIELDS}
        """,
        payload.grade_level,
        payload.text,
    )
    return Passage(**dict(row))


@router.get("", response_model=list[Passage])
async def list_passages(grade_level: Optional[str] = Query(default=None)) -> list[Passage]:
    pool = await get_pool()
    if grade_level is not None:
        rows = await pool.fetch(
            f"SELECT {_SELECT_FIELDS} FROM passages WHERE grade_level = $1 ORDER BY id",
            grade_level,
        )
    else:
        rows = await pool.fetch(f"SELECT {_SELECT_FIELDS} FROM passages ORDER BY id")
    return [Passage(**dict(row)) for row in rows]


@router.get("/{passage_id}", response_model=Passage)
async def get_passage(passage_id: int) -> Passage:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"SELECT {_SELECT_FIELDS} FROM passages WHERE id = $1", passage_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Passage not found")
    return Passage(**dict(row))
