# QueryDesk v3 — Backend Deployment Guide

**Stack:** FastAPI · PostgreSQL · Python 3.13  
**Free hosting:** Neon (DB) + Render (API server)

---

## 1. Local Development Setup

### Prerequisites
- Python 3.11+ installed
- Git

### Install dependencies

```bash
cd D:\MAIN_PROJECTS\mllab-query\mllab-query

# Create virtual environment (already done if you ran setup)
python -m venv backend\.venv

# Activate it
backend\.venv\Scripts\activate          # Windows
# source backend/.venv/bin/activate     # Mac/Linux

# Install packages
pip install -r backend\requirements.txt
pip install "pydantic[email]"           # required for EmailStr
```

### Create your .env file

```bash
copy backend\.env.example backend\.env
```

Open `backend\.env` and fill in:

```ini
DATABASE_URL=postgresql+asyncpg://USER:PASS@HOST/DBNAME
JWT_SECRET=paste-random-string-here
```

Generate a secure JWT secret:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Run locally

```bash
# From repo root
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000/docs — interactive API docs (Swagger UI).

---

## 2. Database — Neon (Free Tier)

Neon gives you a free serverless Postgres instance in 2 minutes.

### Create database

1. Go to https://neon.tech and sign up (free)
2. Click **New Project**
3. Name it `querydesk`, choose region closest to you → **Create**
4. On the dashboard, click **Connection Details**
5. Copy the connection string — it looks like:
   ```
   postgresql://alex:AbC123@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
6. Change `postgresql://` → `postgresql+asyncpg://` for async support:
   ```
   postgresql+asyncpg://alex:AbC123@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?ssl=require
   ```
7. Paste into `DATABASE_URL` in your `.env`

### Run the schema

Install psql if you don't have it: https://www.postgresql.org/download/

```bash
# From repo root — creates all tables, indexes, triggers
psql "postgresql://alex:AbC123@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb" -f backend/schema.sql
```

Expected output:
```
CREATE EXTENSION
CREATE TABLE  ← organizations
CREATE TABLE  ← instructors
CREATE TABLE  ← courses
...
CREATE FUNCTION
DO
```

### Create your first instructor + org (one-time seed)

```bash
psql "YOUR_CONNECTION_STRING" <<'SQL'
-- 1. Create organization
INSERT INTO organizations (name, short_name)
VALUES ('Your University', 'YOUR-UNI')
RETURNING id;

-- 2. Create instructor (copy org id from above)
INSERT INTO instructors (org_id, name, email, password_hash)
VALUES (
  'paste-org-id-here',
  'Dr. Your Name',
  'your@email.com',
  -- Generate hash: python -c "from passlib.context import CryptContext; c=CryptContext(schemes=['bcrypt']); print(c.hash('yourpassword'))"
  'paste-bcrypt-hash-here'
);
SQL
```

Or use the helper script:
```bash
backend\.venv\Scripts\python -c "
from passlib.context import CryptContext
c = CryptContext(schemes=['bcrypt'])
print(c.hash('your-password-here'))
"
```

---

## 3. Deploy API — Render (Free Tier)

Render deploys directly from your GitHub repo with zero config.

### Steps

1. Go to https://render.com and sign up with GitHub
2. Click **New → Web Service**
3. Connect your repo: `hafiz-m-awais/querydesk`
4. Configure:

   | Field | Value |
   |-------|-------|
   | Name | `querydesk-api` |
   | Root Directory | `backend` |
   | Runtime | **Python 3** |
   | Build Command | `pip install -r requirements.txt && pip install "pydantic[email]"` |
   | Start Command | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
   | Instance Type | **Free** |

5. Click **Advanced → Add Environment Variable** and add:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Neon connection string |
   | `JWT_SECRET` | output of `secrets.token_hex(32)` |
   | `CORS_ORIGINS` | `https://hafiz-m-awais.github.io` |
   | `SMTP_HOST` | your SMTP host (or leave blank for now) |
   | `SMTP_PASSWORD` | your SMTP key |
   | `EMAIL_FROM` | noreply@yourdomain.com |
   | `APP_ENV` | `production` |

6. Click **Create Web Service** → Render builds and deploys (~2 min)

Your API will be live at:
```
https://querydesk-api.onrender.com
```

Test it:
```bash
curl https://querydesk-api.onrender.com/health
# → {"status":"ok","version":"3.0.0"}
```

> **Note:** Free Render instances sleep after 15 minutes of inactivity.  
> First request after sleep takes ~30 seconds. Upgrade to Starter ($7/mo) to avoid this.

---

## 4. Test All 6 Endpoints

With the server running (local or Render), open:
```
http://localhost:8000/docs          (local)
https://querydesk-api.onrender.com/docs   (deployed)
```

### Quick curl tests

```bash
BASE=http://localhost:8000

# Health check
curl $BASE/health

# Instructor login (use email + password you seeded)
curl -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'
# → {"access_token":"eyJ...", "instructor_id":"...", "name":"..."}

# Save the token
TOKEN="eyJ..."

# Submit a student query (no auth required)
curl -X POST $BASE/queries \
  -H "Content-Type: application/json" \
  -d '{
    "course_id": "paste-course-uuid",
    "student_name": "Ali Khan",
    "roll_no": "21K-3456",
    "student_email": "ali@nu.edu.pk",
    "subject": "Marks query",
    "description": "Please check my mid marks"
  }'

# List queries (instructor auth required)
curl $BASE/queries \
  -H "Authorization: Bearer $TOKEN"

# Update query status
curl -X PATCH $BASE/queries/QUERY-UUID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","instructor_note":"Marks updated"}'

# Request OTP for student tracker
curl -X POST $BASE/auth/student-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"ali@nu.edu.pk","course_id":"paste-course-uuid"}'

# Verify OTP
curl -X POST $BASE/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"ali@nu.edu.pk","code":"123456","course_id":"paste-course-uuid"}'
```

---

## 5. Migrate Old Google Sheets Data

Export your existing queries from Google Sheets:

1. Open your Google Sheet → **File → Download → CSV**
2. Run the migration:

```bash
# Dry run first — prints rows without inserting
backend\.venv\Scripts\python -m backend.migrate_sheet \
  --csv   path\to\queries_export.csv \
  --course YOUR-COURSE-UUID \
  --dry-run

# Real insert
backend\.venv\Scripts\python -m backend.migrate_sheet \
  --csv   path\to\queries_export.csv \
  --course YOUR-COURSE-UUID
```

Expected CSV column names (auto-detected, case-insensitive):

| Required | Optional |
|----------|----------|
| Name, Email, Roll No, Subject, Description | Timestamp, Status, Note |

---

## 6. Email Setup (Optional but Recommended)

The easiest free option is **Resend** (3,000 emails/month free).

1. Go to https://resend.com → sign up
2. **API Keys** → Create API key → copy it
3. Update `.env` / Render env vars:
   ```ini
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASSWORD=re_xxxxxxxxxxxx
   EMAIL_FROM=noreply@yourdomain.com
   ```

---

## 7. File Structure Reference

```
backend/
├── main.py            ← FastAPI app entry point
├── config.py          ← Environment settings
├── db.py              ← Async DB engine + session
├── auth.py            ← JWT + bcrypt + OTP helpers
├── dependencies.py    ← require_instructor/student guards
├── email_utils.py     ← SMTP email helpers
├── schema.sql         ← Run once to create all tables
├── migrate_sheet.py   ← CSV → Postgres migration script
├── requirements.txt   ← Python dependencies
├── .env.example       ← Copy to .env and fill in secrets
└── routers/
    ├── auth.py        ← POST /auth/login, /student-otp, /verify-otp
    └── queries.py     ← POST/GET /queries, PATCH /queries/{id}
```

---

## 8. Troubleshooting

| Error | Fix |
|-------|-----|
| `Arguments missing for database_url, jwt_secret` | Copy `.env.example` to `.env` and fill in values |
| `ssl: CERTIFICATE_VERIFY_FAILED` | Add `?ssl=require` to your Neon connection string |
| `ModuleNotFoundError: email_validator` | Run `pip install "pydantic[email]"` |
| `port 8000 already in use` | Change port: `uvicorn backend.main:app --port 8001` |
| `relation "queries" does not exist` | Run `psql ... -f backend/schema.sql` first |
| Render deploy fails | Check Build Command includes `pip install "pydantic[email]"` |
| CORS error from browser | Add your GitHub Pages URL to `CORS_ORIGINS` env var |
| Free Render instance slow first load | Expected — free tier sleeps after 15 min idle |
