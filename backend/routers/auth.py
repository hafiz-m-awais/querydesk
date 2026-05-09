"""
backend/routers/auth.py
Endpoints:
  POST /auth/register        � instructor self-registration
  POST /auth/login           � instructor email + password -> access + refresh tokens
  POST /auth/refresh         � exchange refresh token for new access token
  POST /auth/logout          � revoke refresh token
  POST /auth/student-otp     � send OTP to student email
  POST /auth/verify-otp      � verify OTP -> short-lived student token
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import (
    create_access_token,
    generate_otp,
    hash_password,
    verify_password,
)
from backend.config import get_settings
from backend.db import get_db
from backend.email_utils import send_otp_email
from backend.limiter import limiter

router = APIRouter(prefix="/auth", tags=["auth"])

# Proper 60-char bcrypt dummy hash � ensures constant-time compare when email not found
_DUMMY_HASH = "$2b$12$LQv3c1yqBWVHxkd0LQ1Lac.MhKZMTvmJZhZ9PdKSmGYCpFUJ0vJbe"


# -- OTP hashing helpers ------------------------------------------------------

def _hash_otp_code(code: str) -> str:
    """HMAC-SHA256 the OTP if OTP_HMAC_SECRET is configured; else store plaintext."""
    settings = get_settings()
    if settings.otp_hmac_secret:
        return hmac.new(
            settings.otp_hmac_secret.encode(),
            code.encode(),
            hashlib.sha256,
        ).hexdigest()
    return code


def _compare_otp(plain_code: str, stored: str) -> bool:
    """Constant-time compare of a submitted OTP against the stored value."""
    expected = _hash_otp_code(plain_code)
    return hmac.compare_digest(expected, stored)


# -- Schemas ------------------------------------------------------------------

class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class RegisterResponse(BaseModel):
    instructor_id: str
    name: str
    email: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    instructor_id: str
    name: str


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LogoutRequest(BaseModel):
    refresh_token: str


class StudentOtpRequest(BaseModel):
    email: EmailStr
    course_id: str


class StudentOtpResponse(BaseModel):
    detail: str = "OTP sent"


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=12)
    course_id: str


class VerifyOtpResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# -- DB helpers ---------------------------------------------------------------

async def _get_instructor_by_email(db: AsyncSession, email: str) -> dict | None:
    row = await db.execute(
        text(
            "SELECT id, name, email, password_hash, is_active "
            "FROM instructors WHERE email = :email"
        ),
        {"email": email},
    )
    return row.mappings().one_or_none()


async def _course_exists(db: AsyncSession, course_id: str) -> bool:
    row = await db.execute(
        text("SELECT 1 FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    return row.scalar_one_or_none() is not None


async def _store_refresh_token(
    db: AsyncSession, instructor_id: str, raw_token: str, expires_at: datetime
) -> None:
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    await db.execute(
        text(
            "INSERT INTO refresh_tokens (instructor_id, token_hash, expires_at) "
            "VALUES (:iid, :hash, :exp)"
        ),
        {"iid": instructor_id, "hash": token_hash, "exp": expires_at},
    )


# -- Routes -------------------------------------------------------------------

@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Instructor self-registration. Returns 409 if email already exists."""
    existing = await _get_instructor_by_email(db, body.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    hashed = hash_password(body.password)
    row = await db.execute(
        text(
            "INSERT INTO instructors (name, email, password_hash) "
            "VALUES (:name, :email, :hash) RETURNING id, name, email"
        ),
        {"name": body.name.strip(), "email": str(body.email), "hash": hashed},
    )
    rec = row.mappings().one()
    return RegisterResponse(
        instructor_id=str(rec["id"]),
        name=rec["name"],
        email=rec["email"],
    )


@router.post("/login", response_model=LoginResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Instructor login.
    Returns a short-lived access token + long-lived refresh token (30 days).
    """
    instructor = await _get_instructor_by_email(db, body.email)

    # Constant-time check prevents email enumeration via timing side-channel
    password_ok = verify_password(
        body.password,
        instructor["password_hash"] if instructor else _DUMMY_HASH,
    )

    if not instructor or not password_ok or not instructor["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        {"sub": str(instructor["id"]), "role": "instructor"}
    )

    # Opaque refresh token � SHA-256 hash stored, raw value returned once
    raw_refresh = secrets.token_hex(64)
    refresh_expires = datetime.now(timezone.utc) + timedelta(days=30)
    await _store_refresh_token(db, str(instructor["id"]), raw_refresh, refresh_expires)

    return LoginResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        instructor_id=str(instructor["id"]),
        name=instructor["name"],
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_access_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    row = await db.execute(
        text(
            "SELECT rt.instructor_id "
            "FROM refresh_tokens rt "
            "JOIN instructors i ON i.id = rt.instructor_id "
            "WHERE rt.token_hash = :hash "
            "  AND rt.revoked = FALSE "
            "  AND rt.expires_at > NOW() "
            "  AND i.is_active = TRUE"
        ),
        {"hash": token_hash},
    )
    rec = row.mappings().one_or_none()
    if not rec:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    access_token = create_access_token(
        {"sub": str(rec["instructor_id"]), "role": "instructor"}
    )
    return RefreshResponse(access_token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    """Revoke a refresh token. Always 204 regardless of whether token existed."""
    token_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    await db.execute(
        text(
            "UPDATE refresh_tokens SET revoked = TRUE "
            "WHERE token_hash = :hash AND revoked = FALSE"
        ),
        {"hash": token_hash},
    )


@router.post("/student-otp", response_model=StudentOtpResponse)
@limiter.limit("5/minute")
async def request_student_otp(request: Request, body: StudentOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Send a one-time code to a student email for query status access.
    Always returns 200 to avoid email enumeration.
    OTP is HMAC-hashed before storage when OTP_HMAC_SECRET is set.
    """
    settings = get_settings()

    if not await _course_exists(db, body.course_id):
        raise HTTPException(status_code=404, detail="Course not found")

    # Purge expired OTPs for this email before inserting a new one
    await db.execute(
        text("DELETE FROM otp_challenges WHERE email = :email AND expires_at < NOW()"),
        {"email": body.email},
    )

    code = generate_otp()
    stored_code = _hash_otp_code(code)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_ttl_minutes)

    await db.execute(
        text(
            "INSERT INTO otp_challenges (email, code, expires_at) "
            "VALUES (:email, :code, :expires_at)"
        ),
        {"email": body.email, "code": stored_code, "expires_at": expires_at},
    )

    try:
        await send_otp_email(body.email, code)  # send the plaintext code to user
    except Exception:
        pass  # never reveal SMTP failures

    return StudentOtpResponse()


@router.post("/verify-otp", response_model=VerifyOtpResponse)
@limiter.limit("10/minute")
async def verify_otp(request: Request, body: VerifyOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify a student OTP and issue a 1-hour scoped student token.
    """
    # Fetch all active OTPs for this email (avoids timing leak from single-row lookup)
    row = await db.execute(
        text(
            "SELECT id, code FROM otp_challenges "
            "WHERE email = :email AND used = FALSE AND expires_at > NOW()"
        ),
        {"email": body.email},
    )
    challenges = row.mappings().all()

    matched_id = None
    for ch in challenges:
        if _compare_otp(body.code, ch["code"]):
            matched_id = ch["id"]
            break

    if not matched_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )

    if not await _course_exists(db, body.course_id):
        raise HTTPException(status_code=404, detail="Course not found")

    # Mark OTP as used
    await db.execute(
        text("UPDATE otp_challenges SET used = TRUE WHERE id = :id"),
        {"id": matched_id},
    )

    # 1-hour student token scoped to this email + course
    token = create_access_token(
        {"sub": body.email, "role": "student", "course_id": body.course_id},
        expires_in_minutes=60,
    )
    return VerifyOtpResponse(access_token=token)
