-- ============================================================
-- QueryDesk v3  –  PostgreSQL Schema
-- Run once against an empty database:
--   psql $DATABASE_URL -f schema.sql
-- ============================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Organisations ───────────────────────────────────────────
-- One row per university / institute
CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    short_name  TEXT,                        -- e.g. "FAST-NUCES"
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Instructors (users) ─────────────────────────────────────
-- Instructors log in with email + password
CREATE TABLE IF NOT EXISTS instructors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Courses ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id   UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,           -- e.g. "Machine Learning"
    code            TEXT,                    -- e.g. "CS-471"
    section         TEXT,                    -- e.g. "BCS-6A"
    semester        TEXT,                    -- e.g. "Spring 2026"
    submission_open BOOLEAN NOT NULL DEFAULT TRUE,
    -- Validation rules (stored as JSON so frontend/backend share them)
    email_pattern   TEXT NOT NULL DEFAULT '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$',
    roll_pattern    TEXT NOT NULL DEFAULT '^[0-9]{2}[A-Z]{1,3}-[0-9]{4}$',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Queries ─────────────────────────────────────────────────
CREATE TYPE query_status AS ENUM (
    'pending',
    'in_review',
    'resolved',
    'rejected'
);

CREATE TABLE IF NOT EXISTS queries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_name    TEXT NOT NULL,
    roll_no         TEXT NOT NULL,
    student_email   TEXT NOT NULL,
    subject         TEXT NOT NULL,
    description     TEXT NOT NULL,
    attachment_url  TEXT,                    -- optional uploaded file
    status          query_status NOT NULL DEFAULT 'pending',
    instructor_note TEXT,                    -- instructor's reply/note
    notified        BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for instructor's list-queries view (course_id + status filter)
CREATE INDEX IF NOT EXISTS idx_queries_course_id   ON queries (course_id);
CREATE INDEX IF NOT EXISTS idx_queries_status       ON queries (status);
CREATE INDEX IF NOT EXISTS idx_queries_roll_no      ON queries (roll_no);
CREATE INDEX IF NOT EXISTS idx_queries_submitted_at ON queries (submitted_at DESC);

-- ─── Query Events (audit log) ────────────────────────────────
CREATE TYPE event_kind AS ENUM (
    'submitted',
    'status_changed',
    'note_added',
    'email_sent'
);

CREATE TABLE IF NOT EXISTS query_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id    UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    kind        event_kind NOT NULL,
    actor       TEXT,                        -- instructor email or 'system'
    payload     JSONB,                       -- flexible event data
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_events_query_id ON query_events (query_id);

-- ─── OTP Challenges ──────────────────────────────────────────
-- Short-lived one-time codes sent to students for status tracking
CREATE TABLE IF NOT EXISTS otp_challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL,
    code        TEXT NOT NULL,               -- 6-digit string
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for the verify-otp lookup (email + code + used + expires_at)
CREATE INDEX IF NOT EXISTS idx_otp_email          ON otp_challenges (email);
CREATE INDEX IF NOT EXISTS idx_otp_email_used_exp ON otp_challenges (email, used, expires_at);

-- ─── Refresh Tokens ──────────────────────────────────────────
-- Tracks issued refresh tokens so we can revoke them
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id   UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Auto-update updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['instructors','courses','queries']
    LOOP
        -- Only create the trigger if it doesn't already exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_' || t || '_updated_at'
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER trg_%I_updated_at
                 BEFORE UPDATE ON %I
                 FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                t, t
            );
        END IF;
    END LOOP;
END;
$$;
