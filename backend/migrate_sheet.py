"""
backend/migrate_sheet.py
─────────────────────────────────────────────────────────────────────────────
Migrate a Google Sheet CSV export into the QueryDesk v3 Postgres database.

Expected CSV columns (header row, case-insensitive):
  Timestamp, Name, Roll No, Email, Subject, Description, [Status], [Note]

Usage:
  # 1. Export your Google Sheet "Queries" tab as CSV
  # 2. Set DATABASE_URL in .env (or pass --db-url)
  # 3. Run:

  python -m backend.migrate_sheet \
      --csv    path/to/queries_export.csv \
      --course YOUR_COURSE_UUID \
      [--db-url "postgresql+asyncpg://..."] \
      [--dry-run]

Options:
  --csv        Path to the CSV file exported from Google Sheets (required)
  --course     UUID of the target course in the DB (required)
  --db-url     Override DATABASE_URL from .env
  --dry-run    Print rows without inserting anything
  --batch-size Number of rows per INSERT batch (default: 200)
"""
import argparse
import asyncio
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Column aliases ────────────────────────────────────────────────────────────
# Maps canonical field names → possible CSV column headers (lowercase)
COLUMN_MAP: dict[str, list[str]] = {
    "submitted_at":   ["timestamp", "date", "submitted_at", "time"],
    "student_name":   ["name", "student name", "full name", "student_name"],
    "roll_no":        ["roll no", "roll number", "roll_no", "rollno", "id"],
    "student_email":  ["email", "student email", "email address", "student_email"],
    "subject":        ["subject", "query subject", "title"],
    "description":    ["description", "message", "query", "details", "body"],
    "status":         ["status", "query status"],
    "instructor_note":["note", "instructor note", "reply", "instructor_note"],
}

VALID_STATUSES = {"pending", "in_review", "resolved", "rejected"}
DEFAULT_STATUS = "pending"


def _resolve_headers(header_row: list[str]) -> dict[str, int | None]:
    """Map canonical field → column index (or None if not found)."""
    lower = [h.strip().lower() for h in header_row]
    mapping: dict[str, int | None] = {}
    for field, aliases in COLUMN_MAP.items():
        for alias in aliases:
            if alias in lower:
                mapping[field] = lower.index(alias)
                break
        else:
            mapping[field] = None
    return mapping


def _parse_timestamp(raw: str) -> str:
    """Try common GAS timestamp formats; fall back to NOW()."""
    if not raw.strip():
        return datetime.now(timezone.utc).isoformat()
    for fmt in (
        "%m/%d/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%m/%d/%Y %H:%M",
    ):
        try:
            return datetime.strptime(raw.strip(), fmt).isoformat()
        except ValueError:
            continue
    return datetime.now(timezone.utc).isoformat()


def _read_csv(path: Path) -> tuple[dict[str, int | None], list[list[str]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    return _resolve_headers(header), rows


def _build_rows(
    col_map: dict[str, int | None],
    raw_rows: list[list[str]],
    course_id: str,
) -> list[dict]:
    records: list[dict] = []
    skipped = 0

    for i, row in enumerate(raw_rows, start=2):  # 2 = 1-based + header

        def get(field: str) -> str:
            idx = col_map.get(field)
            if idx is None or idx >= len(row):
                return ""
            return row[idx].strip()

        name  = get("student_name")
        roll  = get("roll_no")
        email = get("student_email")
        subj  = get("subject")
        desc  = get("description")

        if not all([name, roll, email, subj, desc]):
            print(f"  [SKIP] Row {i}: missing required field(s) — {row}", file=sys.stderr)
            skipped += 1
            continue

        raw_status = get("status").lower().replace(" ", "_")
        status = raw_status if raw_status in VALID_STATUSES else DEFAULT_STATUS

        records.append({
            "course_id":       course_id,
            "student_name":    name,
            "roll_no":         roll,
            "student_email":   email,
            "subject":         subj,
            "description":     desc,
            "status":          status,
            "instructor_note": get("instructor_note") or None,
            "submitted_at":    _parse_timestamp(get("submitted_at")),
        })

    print(f"  Parsed {len(records)} valid rows, skipped {skipped}")
    return records


async def _insert_batches(
    records: list[dict],
    db_url: str,
    batch_size: int,
    dry_run: bool,
) -> None:
    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(records)} rows. First 3:")
        for r in records[:3]:
            print(" ", r)
        return

    # Import here so the script can be imported without sqlalchemy installed
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from sqlalchemy import text

    engine = create_async_engine(db_url, echo=False)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    inserted = 0
    async with factory() as session:
        for start in range(0, len(records), batch_size):
            batch = records[start : start + batch_size]
            for rec in batch:
                await session.execute(
                    text(
                        "INSERT INTO queries "
                        "(course_id, student_name, roll_no, student_email, subject, "
                        " description, status, instructor_note, submitted_at) "
                        "VALUES (:course_id, :student_name, :roll_no, :student_email, "
                        "        :subject, :description, :status::query_status, "
                        "        :instructor_note, :submitted_at) "
                        "ON CONFLICT DO NOTHING"
                    ),
                    rec,
                )
            await session.commit()
            inserted += len(batch)
            print(f"  Inserted batch {start // batch_size + 1} ({inserted}/{len(records)})")

    await engine.dispose()
    print(f"\n✓ Migration complete — {inserted} rows inserted.")


def main():
    parser = argparse.ArgumentParser(description="Migrate Google Sheet CSV → QueryDesk Postgres")
    parser.add_argument("--csv",        required=True,  help="Path to CSV export")
    parser.add_argument("--course",     required=True,  help="Target course UUID")
    parser.add_argument("--db-url",     default=None,   help="Override DATABASE_URL from .env")
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--batch-size", type=int, default=200)
    args = parser.parse_args()

    # Resolve DB URL
    db_url = args.db_url
    if not db_url:
        try:
            from backend.config import get_settings
            db_url = get_settings().database_url
        except Exception as exc:
            print(f"ERROR: Could not load DATABASE_URL from .env: {exc}", file=sys.stderr)
            sys.exit(1)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"ERROR: CSV file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    print(f"\nQueryDesk v3 — Migration script")
    print(f"  CSV:     {csv_path}")
    print(f"  Course:  {args.course}")
    print(f"  Dry run: {args.dry_run}\n")

    col_map, raw_rows = _read_csv(csv_path)
    print("Column mapping resolved:")
    for field, idx in col_map.items():
        print(f"  {field:20s} → col {idx}")
    print()

    records = _build_rows(col_map, raw_rows, args.course)

    asyncio.run(_insert_batches(records, db_url, args.batch_size, args.dry_run))


if __name__ == "__main__":
    main()
