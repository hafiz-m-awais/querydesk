"""
backend/routers/queries.py
Endpoints:
  POST   /queries           — student submits a query
  GET    /queries           — instructor lists queries (filters + pagination)
  PATCH  /queries/{id}      — instructor updates status / note
"""
import re
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import decode_access_token
from backend.db import get_db
from backend.dependencies import require_instructor

router = APIRouter(prefix="/queries", tags=["queries"])

# ── Schemas ───────────────────────────────────────────────────────────────────

class QuerySubmitRequest(BaseModel):
    course_id: str
    student_name: str
    roll_no: str
    student_email: EmailStr
    subject: str
    description: str
    attachment_url: str | None = None

    @field_validator("subject")
    @classmethod
    def subject_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("subject cannot be blank")
        return v.strip()

    @field_validator("description")
    @classmethod
    def description_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("description cannot be blank")
        return v.strip()


class QuerySubmitResponse(BaseModel):
    id: str
    detail: str = "Query submitted successfully"


class QueryItem(BaseModel):
    id: str
    course_id: str
    student_name: str
    roll_no: str
    student_email: str
    subject: str
    description: str
    attachment_url: str | None
    status: str
    instructor_note: str | None
    notified: bool
    submitted_at: str
    updated_at: str


class QueryListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[QueryItem]


class QueryUpdateRequest(BaseModel):
    status: Literal["pending", "in_review", "resolved", "rejected"] | None = None
    instructor_note: str | None = None
    notified: bool | None = None


class QueryUpdateResponse(BaseModel):
    id: str
    status: str
    instructor_note: str | None
    notified: bool
    updated_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_course(db: AsyncSession, course_id: str) -> dict | None:
    row = await db.execute(
        text(
            "SELECT id, submission_open, email_pattern, roll_pattern "
            "FROM courses WHERE id = :id"
        ),
        {"id": course_id},
    )
    return row.mappings().one_or_none()


async def _get_query_or_404(db: AsyncSession, query_id: str) -> dict:
    row = await db.execute(
        text("SELECT * FROM queries WHERE id = :id"),
        {"id": query_id},
    )
    q = row.mappings().one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    return q


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("", response_model=QuerySubmitResponse, status_code=status.HTTP_201_CREATED)
async def submit_query(body: QuerySubmitRequest, db: AsyncSession = Depends(get_db)):
    """
    Student submits a new query. No authentication required —
    validation is done against the course's regex patterns.
    """
    course = await _get_course(db, body.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if not course["submission_open"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query submission is closed for this course",
        )

    # Validate roll number and email against course-specific patterns
    if not re.fullmatch(course["roll_pattern"], body.roll_no):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Roll number does not match expected format",
        )
    if not re.fullmatch(course["email_pattern"], body.student_email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email does not match expected format",
        )

    row = await db.execute(
        text(
            "INSERT INTO queries "
            "(course_id, student_name, roll_no, student_email, subject, description, attachment_url) "
            "VALUES (:course_id, :student_name, :roll_no, :student_email, :subject, :description, :attachment_url) "
            "RETURNING id"
        ),
        {
            "course_id": body.course_id,
            "student_name": body.student_name,
            "roll_no": body.roll_no,
            "student_email": body.student_email,
            "subject": body.subject,
            "description": body.description,
            "attachment_url": body.attachment_url,
        },
    )
    query_id = str(row.scalar_one())

    # Audit event
    await db.execute(
        text(
            "INSERT INTO query_events (query_id, kind, actor, payload) "
            "VALUES (:qid, 'submitted', :actor, :payload::jsonb)"
        ),
        {
            "qid": query_id,
            "actor": body.student_email,
            "payload": f'{{"roll_no": "{body.roll_no}"}}',
        },
    )

    return QuerySubmitResponse(id=query_id)


@router.get("", response_model=QueryListResponse)
async def list_queries(
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
    course_id: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None, description="Search roll_no or student_name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """
    Instructor: list queries for their courses with optional filters.
    Only returns queries for courses owned by the authenticated instructor.
    """
    instructor_id = instructor["sub"]
    offset = (page - 1) * page_size

    # Build WHERE clauses dynamically
    conditions = ["c.instructor_id = :instructor_id"]
    params: dict = {"instructor_id": instructor_id, "limit": page_size, "offset": offset}

    if course_id:
        conditions.append("q.course_id = :course_id")
        params["course_id"] = course_id

    if status_filter:
        conditions.append("q.status = :status_filter::query_status")
        params["status_filter"] = status_filter

    if search:
        conditions.append("(q.roll_no ILIKE :search OR q.student_name ILIKE :search)")
        params["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    count_row = await db.execute(
        text(
            f"SELECT COUNT(*) FROM queries q "
            f"JOIN courses c ON c.id = q.course_id "
            f"WHERE {where}"
        ),
        params,
    )
    total = count_row.scalar_one()

    rows = await db.execute(
        text(
            f"SELECT q.* FROM queries q "
            f"JOIN courses c ON c.id = q.course_id "
            f"WHERE {where} "
            f"ORDER BY q.submitted_at DESC "
            f"LIMIT :limit OFFSET :offset"
        ),
        params,
    )
    items = [
        QueryItem(
            id=str(r["id"]),
            course_id=str(r["course_id"]),
            student_name=r["student_name"],
            roll_no=r["roll_no"],
            student_email=r["student_email"],
            subject=r["subject"],
            description=r["description"],
            attachment_url=r["attachment_url"],
            status=r["status"],
            instructor_note=r["instructor_note"],
            notified=r["notified"],
            submitted_at=r["submitted_at"].isoformat(),
            updated_at=r["updated_at"].isoformat(),
        )
        for r in rows.mappings()
    ]

    return QueryListResponse(total=total, page=page, page_size=page_size, items=items)


@router.patch("/{query_id}", response_model=QueryUpdateResponse)
async def update_query(
    query_id: str,
    body: QueryUpdateRequest,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """
    Instructor: update a query's status, note, or notification flag.
    Ownership is verified — instructors can only modify their own courses' queries.
    """
    instructor_id = instructor["sub"]

    # Verify ownership
    row = await db.execute(
        text(
            "SELECT q.id, q.status FROM queries q "
            "JOIN courses c ON c.id = q.course_id "
            "WHERE q.id = :qid AND c.instructor_id = :iid"
        ),
        {"qid": query_id, "iid": instructor_id},
    )
    existing = row.mappings().one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Query not found")

    # Build SET clauses for only provided fields
    set_parts: list[str] = []
    params: dict = {"qid": query_id}

    if body.status is not None:
        set_parts.append("status = :status::query_status")
        params["status"] = body.status

    if body.instructor_note is not None:
        set_parts.append("instructor_note = :note")
        params["note"] = body.instructor_note

    if body.notified is not None:
        set_parts.append("notified = :notified")
        params["notified"] = body.notified

    if not set_parts:
        raise HTTPException(status_code=422, detail="No fields to update")

    set_clause = ", ".join(set_parts)
    updated = await db.execute(
        text(
            f"UPDATE queries SET {set_clause} "
            f"WHERE id = :qid "
            f"RETURNING id, status, instructor_note, notified, updated_at"
        ),
        params,
    )
    result = updated.mappings().one()

    # Audit event
    if body.status and body.status != existing["status"]:
        await db.execute(
            text(
                "INSERT INTO query_events (query_id, kind, actor, payload) "
                "VALUES (:qid, 'status_changed', :actor, :payload::jsonb)"
            ),
            {
                "qid": query_id,
                "actor": instructor_id,
                "payload": f'{{"from": "{existing["status"]}", "to": "{body.status}"}}',
            },
        )

    return QueryUpdateResponse(
        id=str(result["id"]),
        status=result["status"],
        instructor_note=result["instructor_note"],
        notified=result["notified"],
        updated_at=result["updated_at"].isoformat(),
    )
