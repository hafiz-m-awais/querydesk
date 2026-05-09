"""
backend/routers/queries.py
Endpoints:
  POST   /queries               -- student submits a query
  GET    /queries               -- instructor lists queries (filters + pagination)
  PATCH  /queries/{id}          -- instructor updates status / note (sends email)
  POST   /queries/bulk-update   -- instructor bulk status update
  GET    /queries/export        -- instructor CSV export
  GET    /queries/student       -- student views own queries (OTP-gated)
"""
import csv
import io
import json
import re
from typing import Annotated, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.dependencies import require_instructor, require_student
from backend.email_utils import send_status_update_email
from backend.limiter import limiter

router = APIRouter(prefix="/queries", tags=["queries"])

# -- Schemas ------------------------------------------------------------------

_SAFE_URL_SCHEMES = {"https", "http"}


def _validate_url(v: str | None) -> str | None:
    if v is None:
        return None
    try:
        parsed = urlparse(v)
        if parsed.scheme not in _SAFE_URL_SCHEMES or not parsed.netloc:
            raise ValueError("attachment_url must be a valid http/https URL")
    except Exception:
        raise ValueError("attachment_url must be a valid http/https URL")
    return v


class QuerySubmitRequest(BaseModel):
    course_id: str
    student_name: str = Field(..., min_length=2, max_length=200)
    roll_no: str = Field(..., min_length=3, max_length=30)
    student_email: EmailStr
    subject: str = Field(..., min_length=1, max_length=300)
    description: str = Field(..., min_length=10, max_length=5000)
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

    @field_validator("attachment_url")
    @classmethod
    def validate_attachment_url(cls, v: str | None) -> str | None:
        return _validate_url(v)


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
    instructor_note: str | None = Field(None, max_length=2000)
    notified: bool | None = None


class QueryUpdateResponse(BaseModel):
    id: str
    status: str
    instructor_note: str | None
    notified: bool
    updated_at: str


class BulkUpdateRequest(BaseModel):
    query_ids: list[str] = Field(..., min_length=1, max_length=200)
    status: Literal["pending", "in_review", "resolved", "rejected"]


class BulkUpdateResponse(BaseModel):
    updated: int


# -- Helpers ------------------------------------------------------------------

async def _get_course(db: AsyncSession, course_id: str) -> dict | None:
    row = await db.execute(
        text(
            "SELECT id, submission_open, email_pattern, roll_pattern, name "
            "FROM courses WHERE id = :id"
        ),
        {"id": course_id},
    )
    return row.mappings().one_or_none()


# -- Routes -------------------------------------------------------------------

@router.post("", response_model=QuerySubmitResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def submit_query(request: Request, body: QuerySubmitRequest, db: AsyncSession = Depends(get_db)):
    """
    Student submits a new query. No auth required.
    Validates against the course roll/email patterns.
    """
    course = await _get_course(db, body.course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if not course["submission_open"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Query submission is closed for this course",
        )

    if not re.fullmatch(course["roll_pattern"], body.roll_no):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Roll number does not match expected format",
        )
    if not re.fullmatch(course["email_pattern"], str(body.student_email)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email does not match expected format for this course",
        )

    # Duplicate guard: same email + subject + course within 5 minutes => 409
    dup = await db.execute(
        text(
            "SELECT 1 FROM queries "
            "WHERE course_id = :course_id AND student_email = :email "
            "  AND subject = :subject "
            "  AND created_at > NOW() - INTERVAL '5 minutes'"
        ),
        {
            "course_id": body.course_id,
            "email": str(body.student_email),
            "subject": body.subject,
        },
    )
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Duplicate submission: this query was already submitted recently",
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
            "student_email": str(body.student_email),
            "subject": body.subject,
            "description": body.description,
            "attachment_url": body.attachment_url,
        },
    )
    query_id = str(row.scalar_one())

    # Audit event -- json.dumps ensures safe serialization (no f-string injection)
    await db.execute(
        text(
            "INSERT INTO query_events (query_id, kind, actor, payload) "
            "VALUES (:qid, :kind::event_kind, :actor, :payload::jsonb)"
        ),
        {
            "qid": query_id,
            "kind": "submitted",
            "actor": str(body.student_email),
            "payload": json.dumps({"roll_no": body.roll_no}),
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
    """Instructor: list queries for their courses with filters and pagination."""
    instructor_id = instructor["sub"]
    offset = (page - 1) * page_size

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

    where_clause = " AND ".join(conditions)

    count_row = await db.execute(
        text(
            f"SELECT COUNT(*) FROM queries q "
            f"JOIN courses c ON c.id = q.course_id "
            f"WHERE {where_clause}"
        ),
        params,
    )
    total = count_row.scalar_one()

    rows = await db.execute(
        text(
            f"SELECT q.* FROM queries q "
            f"JOIN courses c ON c.id = q.course_id "
            f"WHERE {where_clause} "
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


@router.get("/student", response_model=QueryListResponse)
async def get_student_queries(
    student: Annotated[dict, Depends(require_student)],
    db: AsyncSession = Depends(get_db),
):
    """
    Student: retrieve their own queries for the course in their JWT.
    Requires a student token issued by POST /auth/verify-otp.
    """
    email = student["sub"]
    course_id = student.get("course_id")

    if not course_id:
        raise HTTPException(status_code=400, detail="Token missing course_id claim")

    rows = await db.execute(
        text(
            "SELECT * FROM queries "
            "WHERE student_email = :email AND course_id = :course_id "
            "ORDER BY submitted_at DESC"
        ),
        {"email": email, "course_id": course_id},
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
    total = len(items)
    return QueryListResponse(total=total, page=1, page_size=max(total, 50), items=items)


@router.get("/export")
async def export_queries_csv(
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
    course_id: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
):
    """Instructor: download queries as a CSV file. Scoped to their courses."""
    instructor_id = instructor["sub"]

    conditions = ["c.instructor_id = :instructor_id"]
    params: dict = {"instructor_id": instructor_id}

    if course_id:
        conditions.append("q.course_id = :course_id")
        params["course_id"] = course_id

    if status_filter:
        conditions.append("q.status = :status_filter::query_status")
        params["status_filter"] = status_filter

    where_clause = " AND ".join(conditions)

    rows = await db.execute(
        text(
            f"SELECT q.id, q.roll_no, q.student_name, q.student_email, "
            f"       q.subject, q.description, q.status, q.instructor_note, "
            f"       q.notified, q.submitted_at, q.updated_at, c.name AS course_name "
            f"FROM queries q "
            f"JOIN courses c ON c.id = q.course_id "
            f"WHERE {where_clause} "
            f"ORDER BY q.submitted_at DESC"
        ),
        params,
    )
    all_rows = rows.mappings().all()

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "id", "course_name", "roll_no", "student_name", "student_email",
            "subject", "description", "status", "instructor_note",
            "notified", "submitted_at", "updated_at",
        ],
    )
    writer.writeheader()
    for r in all_rows:
        writer.writerow({
            "id": str(r["id"]),
            "course_name": r["course_name"],
            "roll_no": r["roll_no"],
            "student_name": r["student_name"],
            "student_email": r["student_email"],
            "subject": r["subject"],
            "description": r["description"],
            "status": r["status"],
            "instructor_note": r["instructor_note"] or "",
            "notified": r["notified"],
            "submitted_at": r["submitted_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        })

    csv_bytes = output.getvalue().encode("utf-8-sig")  # BOM for Excel compatibility
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=queries_export.csv"},
    )


@router.post("/bulk-update", response_model=BulkUpdateResponse)
async def bulk_update_queries(
    body: BulkUpdateRequest,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """
    Instructor: set the same status on multiple queries at once.
    Only updates queries belonging to the authenticated instructor's courses.
    """
    instructor_id = instructor["sub"]

    result = await db.execute(
        text(
            "UPDATE queries q SET status = :status::query_status "
            "FROM courses c "
            "WHERE q.course_id = c.id "
            "  AND c.instructor_id = :iid "
            "  AND q.id = ANY(:ids::uuid[]) "
            "RETURNING q.id"
        ),
        {
            "status": body.status,
            "iid": instructor_id,
            "ids": body.query_ids,
        },
    )
    updated_ids = [str(r[0]) for r in result.fetchall()]

    for qid in updated_ids:
        await db.execute(
            text(
                "INSERT INTO query_events (query_id, kind, actor, payload) "
                "VALUES (:qid, :kind::event_kind, :actor, :payload::jsonb)"
            ),
            {
                "qid": qid,
                "kind": "status_changed",
                "actor": instructor_id,
                "payload": json.dumps({"to": body.status, "bulk": True}),
            },
        )

    return BulkUpdateResponse(updated=len(updated_ids))


@router.patch("/{query_id}", response_model=QueryUpdateResponse)
async def update_query(
    query_id: str,
    body: QueryUpdateRequest,
    instructor: Annotated[dict, Depends(require_instructor)],
    db: AsyncSession = Depends(get_db),
):
    """
    Instructor: update a query status, note, or notified flag.
    Sends a status-change email to the student automatically.
    """
    instructor_id = instructor["sub"]

    row = await db.execute(
        text(
            "SELECT q.id, q.status, q.student_name, q.student_email, q.subject "
            "FROM queries q "
            "JOIN courses c ON c.id = q.course_id "
            "WHERE q.id = :qid AND c.instructor_id = :iid"
        ),
        {"qid": query_id, "iid": instructor_id},
    )
    existing = row.mappings().one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Query not found")

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

    status_changed = body.status is not None and body.status != existing["status"]

    if status_changed:
        await db.execute(
            text(
                "INSERT INTO query_events (query_id, kind, actor, payload) "
                "VALUES (:qid, :kind::event_kind, :actor, :payload::jsonb)"
            ),
            {
                "qid": query_id,
                "kind": "status_changed",
                "actor": instructor_id,
                "payload": json.dumps({"from": existing["status"], "to": body.status}),
            },
        )
        # Notify student by email -- failure is silenced so the update still succeeds
        try:
            await send_status_update_email(
                to=existing["student_email"],
                student_name=existing["student_name"],
                query_subject=existing["subject"],
                new_status=body.status,
                instructor_note=body.instructor_note or result["instructor_note"],
            )
        except Exception:
            pass

    return QueryUpdateResponse(
        id=str(result["id"]),
        status=result["status"],
        instructor_note=result["instructor_note"],
        notified=result["notified"],
        updated_at=result["updated_at"].isoformat(),
    )
