"""
backend/auth.py
JWT issuance / verification and password hashing helpers.
"""
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from backend.config import get_settings

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(payload: dict[str, Any], expires_in_minutes: int | None = None) -> str:
    """
    Issue a signed JWT.
    payload must include at least {"sub": "<instructor_id>"}.
    expires_in_minutes overrides the global default when provided.
    """
    settings = get_settings()
    data = payload.copy()
    minutes = expires_in_minutes if expires_in_minutes is not None else settings.jwt_access_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    data["exp"] = expire
    data["iat"] = datetime.now(timezone.utc)
    return jwt.encode(data, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode and verify a JWT.
    Raises jose.JWTError on any failure (expired, invalid signature, …).
    """
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


# ── OTP helpers ───────────────────────────────────────────────────────────────

def generate_otp(length: int | None = None) -> str:
    settings = get_settings()
    n = length or settings.otp_length
    return "".join(secrets.choice(string.digits) for _ in range(n))
