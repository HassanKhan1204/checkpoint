from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db.postgres import get_pool
from app.models.schemas import Teacher
from app.services.auth import decode_access_token

# auto_error=False so a missing header raises our own 401 with a clear
# detail message, rather than FastAPI's generic "Not authenticated" 403.
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_teacher(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> Teacher:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        teacher_id = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired session — please log in again")

    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, name, email, role, created_at FROM teachers WHERE id = $1", teacher_id
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return Teacher(**dict(row))
