"""
backend/routers/auth.py
Endpoints:
  POST /auth/login           — instructor email + password → access token
  POST /auth/student-otp     — send OTP to student email
  POST /auth/verify-otp      — verify OTP → short-lived student token
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import (
    create_access_token,
    decode_access_token,
    generate_otp,
    verify_password,
)
from backend.config import get_settings
from backend.db import get_db
from backend.email_utils import send_otp_email

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    instructor_id: str
    name: str


class StudentOtpRequest(BaseModel):
    email: EmailStr
    course_id: str


class StudentOtpResponse(BaseModel):
    detail: str = "OTP sent"


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str
    course_id: str


class VerifyOtpResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_instructor_by_email(db: AsyncSession, email: str) -> dict | None:
    row = await db.execute(
        text("SELECT id, name, email, password_hash, is_active FROM instructors WHERE email = :email"),
        {"email": email},
    )
    return row.mappings().one_or_none()


async def _course_exists(db: AsyncSession, course_id: str) -> bool:
    row = await db.execute(
        text("SELECT 1 FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    return row.scalar_one_or_none() is not None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Instructor login.
    Returns a signed JWT valid for JWT_ACCESS_EXPIRE_MINUTES minutes.
    """
    instructor = await _get_instructor_by_email(db, body.email)

    # Constant-time check — don't reveal whether email exists
    dummy_hash = "$2b$12$eImiTXuWVxfM37uY4JANjQ"  # bcrypt dummy
    password_ok = verify_password(
        body.password,
        instructor["password_hash"] if instructor else dummy_hash,
    )

    if not instructor or not password_ok or not instructor["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        {"sub": str(instructor["id"]), "role": "instructor"}
    )
    return LoginResponse(
        access_token=token,
        instructor_id=str(instructor["id"]),
        name=instructor["name"],
    )


@router.post("/student-otp", response_model=StudentOtpResponse)
async def request_student_otp(body: StudentOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Send a one-time code to a student's email so they can check their query status.
    Always returns 200 to avoid email enumeration.
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
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_ttl_minutes)

    await db.execute(
        text(
            "INSERT INTO otp_challenges (email, code, expires_at) "
            "VALUES (:email, :code, :expires_at)"
        ),
        {"email": body.email, "code": code, "expires_at": expires_at},
    )

    # Fire and forget — don't surface SMTP errors to the student
    try:
        await send_otp_email(body.email, code)
    except Exception:
        pass  # log in production; silently succeed here to avoid enumeration

    return StudentOtpResponse()


@router.post("/verify-otp", response_model=VerifyOtpResponse)
async def verify_otp(body: VerifyOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify the OTP sent to a student and return a short-lived student token.
    """
    row = await db.execute(
        text(
            "SELECT id FROM otp_challenges "
            "WHERE email = :email AND code = :code AND used = FALSE AND expires_at > NOW() "
            "LIMIT 1"
        ),
        {"email": body.email, "code": body.code},
    )
    challenge = row.mappings().one_or_none()

    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )

    # Mark used
    await db.execute(
        text("UPDATE otp_challenges SET used = TRUE WHERE id = :id"),
        {"id": challenge["id"]},
    )

    # Issue a short-lived token scoped to this student email
    token = create_access_token(
        {
            "sub": body.email,
            "role": "student",
            "course_id": body.course_id,
            "exp_override_minutes": 60,  # 1 h for student tracker
        }
    )
    return VerifyOtpResponse(access_token=token)
