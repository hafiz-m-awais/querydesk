# QueryDesk — University-Scale Plan for FAST-NUCES Islamabad

> **Status:** Planning document · May 2026  
> **Audience:** Developer / IT coordinator expanding QueryDesk beyond a single course

---

## 1. What Exists Today

QueryDesk is a **zero-cost, serverless** student query system built on:

| Layer | Technology | Role |
|---|---|---|
| Frontend | GitHub Pages (static) | Hosts `index.html` (student form) and `admin.html` (instructor panel) |
| Backend | Google Apps Script (GAS) | Handles form submissions, email notifications, data storage |
| Database | Google Sheets | One sheet per instructor deployment, 19-column `Queries` tab |
| File storage | Google Drive | Attachment uploads; MIME allowlist enforced |
| Email | GAS `MailApp` | 3 triggers: submit → instructor, submit → student, resolve/reject → student |

### Current capabilities
- 5 configurable query types (attendance, marks, assignment, final, project)
- Per-course settings (name, term, sections, session count, session label, isLab flag)
- Duplicate guard (same roll + type + lab within 24 hours)
- Public roll-number status tracker
- Admin panel: filter, sort, update status, delete, export CSV
- Urgent flag with email subject prefix

### Hard limits at the current scale
1. **One instructor per deployment** — `ADMIN_PASSWORD` and `INSTRUCTOR_EMAIL` are per-GAS Script Properties
2. **SCRIPT_URL is hardcoded** — both HTML files have the GAS deployment URL baked in; any new instructor needs a code fork
3. **Email domain is hardcoded** — `EMAIL_RE` regex only accepts `@nu.edu.pk` / `@isb.nu.edu.pk`; blocks every non-NUCES student
4. **Query types are hardcoded** — `ALL_TYPES` object in `index.html` cannot be customised without editing code
5. **No self-service onboarding** — a new instructor cannot set up their own instance without developer help
6. **GAS email quota** — 100 emails/day on a personal Gmail; 1,500/day on Google Workspace; a busy department will hit this

---

## 2. Target State — FAST-NUCES Department Rollout

Any faculty member at FAST-NUCES Islamabad should be able to:

1. Click a setup link
2. Fill in their course details (name, sections, email)
3. Receive a unique student link and admin link within 5 minutes
4. Manage all queries from their own admin panel
5. Never touch code

Students should be able to:
1. See all active courses in one place (a directory)
2. Submit queries to any of their courses
3. Track all their query statuses with a single roll number

---

## 3. Recommended Architecture — Option A (Stay on GAS, zero cost)

This extends the current stack without adding a database server, hosting cost, or login system. Each instructor still gets their **own GAS deployment** (isolated data), but the frontend is shared and driven by a URL parameter.

```
STUDENT FLOW
─────────────────────────────────────────────────────────────────
directory.html          →  lists all active FAST-NUCES courses
    │
    ├── ML for Business Analytics  → index.html?gs=AKfycbw...aaa
    ├── Data Structures Lab        → index.html?gs=AKfycbw...bbb
    └── Operating Systems          → index.html?gs=AKfycbw...ccc

index.html?gs=<TEACHER_GAS_URL>
    │   reads ?gs= param at load time → sets SCRIPT_URL dynamically
    │   loads courseSettings from that GAS → applies branding
    └── submits queries to that specific GAS deployment

INSTRUCTOR FLOW
─────────────────────────────────────────────────────────────────
admin.html?gs=<TEACHER_GAS_URL>
    │   reads ?gs= param → sets SCRIPT_URL dynamically
    └── full admin panel connected to teacher's own sheet

EACH INSTRUCTOR OWNS
─────────────────────────────────────────────────────────────────
  - One Google Sheet     (their query database)
  - One GAS deployment   (their backend, their Script Properties)
  - One Google Drive     (their attachment folder, named after course)
  - Their own admin link (admin.html?gs=THEIR_URL)
```

### What changes in code

| File | Change | Complexity |
|---|---|---|
| `index.html` | Read `?gs=` URL param; use it as `SCRIPT_URL` | Trivial (2 lines) |
| `admin.html` | Same `?gs=` param read | Trivial (2 lines) |
| `index.html` | Make `EMAIL_RE` configurable from `courseSettings.emailDomain` | Small |
| `Code.gs` | Add `emailDomain` field to `DEFAULT_COURSE_SETTINGS` | Small |
| `admin.html` | Add `emailDomain` field to Course Settings modal | Small |
| New: `directory.html` | Static page listing all courses with their `?gs=` links | Medium |
| New: onboarding doc / wizard | Step-by-step guide for each new instructor | Medium |

### What does NOT change
- `Code.gs` logic, GAS deployment process, Google Sheets schema
- GitHub Pages hosting (still free, still the same repo)
- All existing functionality for the current ML for Business Analytics course

---

## 4. Recommended Architecture — Option B (Proper Multi-Tenant Backend)

Use this if FAST-NUCES wants a **single unified system** with central authentication, analytics across all courses, and no per-instructor GAS setup.

```
                    ┌─────────────────────────────────┐
GitHub Pages        │  Supabase (free tier)            │
(shared frontend)   │                                  │
  index.html  ─────▶│  Tables:                         │
  admin.html  ─────▶│    instructors  (id, name, email, dept)
  directory.html    │    courses      (id, instructor_id, name, term, …)
                    │    queries      (id, course_id, roll, type, …)
                    │    query_types  (course_id, type, enabled)
                    │                                  │
                    │  Auth: email magic link (no pwd) │
                    │  Storage: Supabase Storage       │
                    │    (replaces Google Drive)       │
                    │                                  │
                    │  Edge Functions (replaces GAS):  │
                    │    POST /submit                  │
                    │    POST /update-status           │
                    │    GET  /status/:roll            │
                    └─────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Resend (email)   │
                    │  Free: 3k/month   │
                    └───────────────────┘
```

**Gains over Option A:**
- One URL for everyone — no `?gs=` parameters
- Instructor self-registers with their `@nu.edu.pk` email
- Unified directory auto-populated from database
- No per-instructor GAS setup
- Email via Resend: 3,000 free emails/month (vs. 100–1,500 with GAS MailApp)
- Analytics across the whole department (pending rate, avg resolution time, busiest courses)
- No GAS 6-minute execution timeout
- Proper JWT auth (no shared passwords)

**Costs:**
- Supabase free tier: 500MB database, 1GB file storage, 2GB bandwidth/month → sufficient for a department
- Resend free tier: 3,000 emails/month
- GitHub Pages: still free
- **Total: £0/month** until scale exceeds free tier limits

**Trade-offs:**
- Requires a real deployment step (Supabase project setup, schema migration)
- Edge Functions need writing (TypeScript/JavaScript)
- More complex than GAS — needs a developer to maintain
- Migration effort for existing instructor data

---

## 5. Phased Roadmap

### Phase 1 — Multi-instructor on current GAS stack (Option A)
*Effort: 1–2 days · Zero new infrastructure*

- [ ] `?gs=` URL parameter support in `index.html` and `admin.html`
- [ ] `emailDomain` field in `courseSettings` (configurable from admin panel)
- [ ] `directory.html` — static course listing page
- [ ] `DEPLOY.md` updated with per-instructor setup instructions
- [ ] Instructor onboarding checklist (copy GAS, set Script Properties, paste URL into directory)

**Outcome:** Any FAST-NUCES instructor can set up their own QueryDesk in ~15 minutes using only the existing guide. The IT coordinator maintains `directory.html` by adding a new line per course.

---

### Phase 2 — Quality of life improvements
*Effort: 2–3 days · Still on GAS + GitHub Pages*

- [ ] **Instructor name on student form** — `courseSettings.instructorName` already stored; just display it in the card header
- [ ] **Per-course Drive folder** named after course (currently all go to `ML Lab Query Attachments`)
- [ ] **Export improvements** — filter-aware CSV (export only filtered rows, not all)
- [ ] **Admin analytics tab** — pending rate, avg resolution time, queries by type (computed from `allRows`, no backend change)
- [ ] **Student email configurable tracking URL** — replace hardcoded `hafiz-m-awais.github.io/mllab-query/` in emails with a `courseSettings.studentUrl` field

---

### Phase 3 — Migrate to Supabase (Option B)
*Effort: 1–2 weeks · Recommended for 10+ instructors*

- [ ] Supabase project setup, schema design
- [ ] Auth: `@nu.edu.pk` email magic link for instructors
- [ ] Data migration script: existing Sheets → Supabase tables
- [ ] Rewrite GAS backend as Supabase Edge Functions
- [ ] Rewrite frontend JSONP calls as standard `fetch` to Supabase REST API
- [ ] Email via Resend (drop-in replacement for MailApp)
- [ ] Unified `directory.html` auto-generated from DB
- [ ] Department analytics dashboard

---

## 6. GAS Quotas Reference

These limits apply per Google account running a GAS deployment:

| Quota | Personal Gmail | Google Workspace (FAST) |
|---|---|---|
| Emails sent per day | 100 | 1,500 |
| Script execution time | 6 min/run | 6 min/run |
| Triggers per script | 20 | 20 |
| Script properties storage | 9KB | 9KB |
| Spreadsheet rows | 10M | 10M |

**Implication:** A single instructor teaching 3 sections of ~40 students could receive 20–30 queries/day during a marks dispute period. At 3 emails per query (instructor + student confirm + resolve) that is 60–90 emails/day — within the 100/day Gmail limit but close to it. Instructors should use a Google Workspace (`@nu.edu.pk`) account, not a personal Gmail, to get the 1,500/day limit.

---

## 7. Email Domain Configuration Plan

Currently hardcoded in `index.html`:

```javascript
var EMAIL_RE = /^[ik](2[0-6])\d{4}@(isb\.)?nu\.edu\.pk$/i;
```

This must become a `courseSettings` field so each instructor can configure it.

**Proposed `courseSettings` addition:**

```json
{
  "emailDomain": "nu.edu.pk",
  "emailPattern": "^[ik](2[0-6])\\d{4}@(isb\\.)?nu\\.edu\\.pk$"
}
```

The admin panel would show:
- **Email domain** (display only): `nu.edu.pk` — shown to students as a hint
- **Email regex** (advanced, optional): leave blank to accept any email at that domain

For FAST-NUCES this changes nothing. For another university (e.g. NUST, LUMS) an instructor sets their own domain and the form accepts their students.

---

## 8. Directory Page Design (`directory.html`)

A lightweight static page listing all active courses. The IT coordinator adds one row per course.

```
FAST-NUCES QueryDesk — Course Directory
────────────────────────────────────────────────────────────────
Spring 2026

  ML for Business Analytics          Dr. Ahmed
  BSBA-6A · BSBA-6B · MSBA          → Submit query
  
  Data Structures                    Dr. Fatima
  CS-4A · CS-4B                     → Submit query

  Operating Systems Lab              Mr. Bilal
  CS-6A · CS-6B · CS-6C             → Submit query

────────────────────────────────────────────────────────────────
```

Each "Submit query" link is `index.html?gs=ENCODED_GAS_URL`.

Implementation: a plain HTML file with a hard-coded array of course objects. No backend needed. The IT coordinator edits this file when a new instructor is onboarded.

```javascript
// In directory.html — maintained by IT coordinator
var COURSES = [
  { name: 'ML for Business Analytics', instructor: 'Dr. Ahmed', sections: ['BSBA-6A','BSBA-6B','MSBA'], gasUrl: 'https://script.google.com/macros/s/AKfycbw.../exec' },
  { name: 'Data Structures',           instructor: 'Dr. Fatima', sections: ['CS-4A','CS-4B'],            gasUrl: 'https://script.google.com/macros/s/AKfycbx.../exec' },
];
```

---

## 9. Per-Instructor Setup Checklist (Phase 1)

Steps a new FAST-NUCES instructor follows after Phase 1 is built:

```
[ ] 1. Go to sheets.google.com → New blank spreadsheet → name it "QueryDesk — <Course Name>"
[ ] 2. Extensions → Apps Script → paste Code.gs → save
[ ] 3. Project Settings → Script Properties → add:
         ADMIN_PASSWORD = (strong password of your choice)
         INSTRUCTOR_EMAIL = yourname@nu.edu.pk
[ ] 4. Deploy → New deployment → Web app
         Execute as: Me
         Who has access: Anyone
         → Copy the deployment URL
[ ] 5. Open admin.html?gs=<YOUR_URL> in browser → log in → go to Settings
[ ] 6. Fill in: Course Name, Term, Sections, Session Count, Session Label, Email Domain
[ ] 7. Send IT coordinator your deployment URL so they can add you to directory.html
[ ] 8. Share with students: https://hafiz-m-awais.github.io/mllab-query/?gs=<YOUR_URL>
[ ] 9. Bookmark your admin link: https://hafiz-m-awais.github.io/mllab-query/admin.html?gs=<YOUR_URL>
```

---

## 10. Decision Summary

| Question | Option A (GAS) | Option B (Supabase) |
|---|---|---|
| Cost | £0 | £0 (within free tier) |
| Setup time for first instructor | 15 min | 1–2 weeks (initial dev) |
| Setup time for each new instructor | 15 min | 2 min (self-register) |
| Max instructors before issues | ~20 (email quota) | Unlimited |
| Maintenance complexity | Low | Medium |
| Requires a developer | Rarely | Yes, for initial build |
| Student experience | Same URL, different `?gs=` | One URL, course picker |
| Data isolation | Complete (per-GAS-deployment) | Row-level security in Supabase |
| Recommended for | ≤ 15 instructors | 15+ instructors or IT wants central control |

**Recommendation for FAST-NUCES right now:** Start with **Option A, Phase 1**. It can be built in a day, costs nothing, requires no new accounts or infrastructure, and works immediately for any instructor in the department. If the system grows to 15+ active instructors or IT wants a unified dashboard, migrate to Option B.
