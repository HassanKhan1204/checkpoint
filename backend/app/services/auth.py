"""Password hashing and session-token (JWT) helpers.

Tokens are intentionally simple, per the hackathon scope: a signed JWT
carrying the teacher's id, no expiry and no refresh flow. A teacher stays
signed in until they log out (or clear localStorage) on the frontend.
"""

import jwt
from passlib.context import CryptContext

from app.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def _require_secret() -> str:
    if not settings.jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is not configured — set it in backend/.env "
            "(see .env.example)"
        )
    return settings.jwt_secret


def create_access_token(teacher_id: int) -> str:
    payload = {"sub": str(teacher_id)}
    return jwt.encode(payload, _require_secret(), algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    """Returns the teacher id encoded in the token, or raises ValueError."""
    try:
        payload = jwt.decode(token, _require_secret(), algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as exc:
        raise ValueError("invalid or malformed token") from exc
