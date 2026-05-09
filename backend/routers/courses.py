"""
backend/routers/courses.py
Endpoints:
  GET    /courses           -- public: list all open courses
  GET    /courses/{id}      -- public: course detail + validation rules
  POST   /courses           -- instructor: create a course
  PATCH  /courses/{id}      -- instructor: update course settings
  DELETE /courses/{id}      -- instructor: delete a course
"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.dependencies import require_instructor

router = APIRouter(prefix="/courses", tags=["courses"])


# -- Schemas ------------------------------------------------------------------

class CoursePublic(BaseModel):
    id: str
    instructor_id: str
    name: str
    code: str | None
    section: str | None
    semester: str | None
    submission_open: bool
    email_pattern: str
    roll_pattern: str
    created_at: str


class CourseListResponse(BaseModel):
    total: int
    items: list[CoursePublic]


class CourseCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    code: str | None = Field(None, max_length=20)
    section: str | None = Field(None, max_length=50)
    semester: str | None = Field(None, max_length=50)
    submission_open: bool = True
    email_pattern: str = Field(
        r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$",
        max_length=500,
    )
    roll_pattern: str = Field(
        r"^[0-9]{2}[A-Z]{1,3}-[0-9]{4}$",
        max_length=500,
    )


class CourseUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    code: str | None = Field(None, max_length=20)
    section: str | None = Field(None, max_length=50)
    semester: str | None = Field(None, max_length=50)
    submission_open: bool | None = None
    email_pattern: str | None = Field(None, max_length=500)
    roll_pattern: str | None = Field(None, max_length=500)


class CourseResponse(BaseModel):
    id: str
    instructor_id: str
    name: str
    code: str | None
    section: str | None
    semester: str | None
    submission_open: bool
    email_pattern: str
    roll_pattern: str
    created_at: str
    updated_at: str


# -- Helpers ------------------------------------------------------------------

def _row_to_public(r: dict) -> CoursePublic:
    return CoursePublic(
        id=str(r["id"]),
        instructor_id=str(r["instructor_id"]),
        name=r["name"],
        code=r["code"],
        section=r["section"],
        semester=r["semester"],
        submission_open=r["submission_open"],
        email_pattern=r["email_pattern"],
        roll_pattern=r["roll_pattern"],
        created_at=r["created_at"].isoformat(),
    )


def _row_to_response(r: dict) -> CourseResponse:
    return CourseResponse(
        id=str(r["id"]),
        instructor_id=str(r["instructor_id"]),
        name=r["name"],
        code=r["code"],
        section=r["section"],
        semester=r["semester"],
        submission_open=r["submission_open"],
        email_pattern=r["email_pattern"],
        roll_pattern=r["roll_pattern"],
        created_at=r["created_at"].isoformat(),
        updated_at=r["updated_at"].isoformat(),
    )


# -- Routes -------------------------------------------------------------------

@router.get("", response_model=CourseListResponse)
async def list_courses(db: AsyncSession = Depends(get_db)):
    """Public: list all courses (no auth required)."""
    rows = await db.execute(
        text(
            "SELECT c.*, i.name AS instructor_name "
            "FROM courses c "
            "JOIN instructors i ON i.id = c.instructor_id "
            "ORDER BY c.semester DESC, c.name ASC"
        )
    )
    items = [_row_to_public(r) for r in rows.mappings()]
    return CourseListResponse(total=len(items), items=items)


@router.get("/{course_id}", response_model=CoursePublic)
async def get_course(course_id: str, db: AsyncSession = Depends(get_db)):
    """Public: get a single course by ID including validation patterns."""
    row = await db.execute(
        text("SELECT * FROM courses WHERE id = :id"),
        {"id": course_id},
    )
    course = row.mappings().one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return _row_to_public(course)


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def create_course(
    body: CourseCreateRequest,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """Instructor: create a new course."""
    row = await db.execute(
        text(
            "INSERT INTO courses "
            "(instructor_id, name, code, section, semester, submission_open, email_pattern, roll_pattern) "
            "VALUES (:iid, :name, :code, :section, :semester, :open, :epat, :rpat) "
            "RETURNING *"
        ),
        {
            "iid": instructor["sub"],
            "name": body.name,
            "code": body.code,
            "section": body.section,
            "semester": body.semester,
            "open": body.submission_open,
            "epat": body.email_pattern,
            "rpat": body.roll_pattern,
        },
    )
    return _row_to_response(row.mappings().one())


@router.patch("/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: str,
    body: CourseUpdateRequest,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """Instructor: update course settings. Only the owning instructor can update."""
    instructor_id = instructor["sub"]

    # Verify ownership
    check = await db.execute(
        text("SELECT id FROM courses WHERE id = :id AND instructor_id = :iid"),
        {"id": course_id, "iid": instructor_id},
    )
    if not check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Course not found")

    set_parts: list[str] = []
    params: dict = {"id": course_id}

    field_map = {
        "name": ("name", body.name),
        "code": ("code", body.code),
        "section": ("section", body.section),
        "semester": ("semester", body.semester),
        "submission_open": ("open", body.submission_open),
        "email_pattern": ("epat", body.email_pattern),
        "roll_pattern": ("rpat", body.roll_pattern),
    }
    col_to_param = {
        "name": "name", "code": "code", "section": "section",
        "semester": "semester", "submission_open": "open",
        "email_pattern": "epat", "roll_pattern": "rpat",
    }

    for col, (param, val) in field_map.items():
        if val is not None:
            set_parts.append(f"{col} = :{param}")
            params[param] = val

    if not set_parts:
        raise HTTPException(status_code=422, detail="No fields to update")

    set_clause = ", ".join(set_parts)
    updated = await db.execute(
        text(f"UPDATE courses SET {set_clause} WHERE id = :id RETURNING *"),
        params,
    )
    return _row_to_response(updated.mappings().one())


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: str,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """Instructor: delete a course (cascades to queries). Ownership verified."""
    instructor_id = instructor["sub"]
    result = await db.execute(
        text(
            "DELETE FROM courses WHERE id = :id AND instructor_id = :iid RETURNING id"
        ),
        {"id": course_id, "iid": instructor_id},
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Course not found")
