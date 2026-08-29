from fastapi import APIRouter, Depends, HTTPException

from app.db.postgres import get_pool
from app.dependencies import get_current_teacher
from app.models.schemas import AuthResponse, LoginIn, SignupIn, Teacher
from app.services.auth import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=201)
async def signup(payload: SignupIn) -> AuthResponse:
    pool = await get_pool()
    existing = await pool.fetchval("SELECT 1 FROM teachers WHERE email = $1", payload.email)
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    password_hash = hash_password(payload.password)
    row = await pool.fetchrow(
        """
        INSERT INTO teachers (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, role, created_at
        """,
        payload.name,
        payload.email,
        password_hash,
    )
    teacher = Teacher(**dict(row))
    return AuthResponse(access_token=create_access_token(teacher.id), teacher=teacher)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginIn) -> AuthResponse:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, email, role, created_at, password_hash FROM teachers WHERE email = $1",
        payload.email,
    )
    # Same generic error whether the email is unknown or the password is
    # wrong — don't let login responses confirm which emails have accounts.
    if row is None or row["password_hash"] is None or not verify_password(
        payload.password, row["password_hash"]
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    teacher = Teacher(**{k: v for k, v in dict(row).items() if k != "password_hash"})
    return AuthResponse(access_token=create_access_token(teacher.id), teacher=teacher)


@router.get("/me", response_model=Teacher)
async def me(current_teacher: Teacher = Depends(get_current_teacher)) -> Teacher:
    return current_teacher
