# QueryDesk v3 — Deployment Guide

> **Stack:** FastAPI (Python) · PostgreSQL (Neon) · Render (backend hosting) · GitHub Pages (frontend)  
> **Repo:** https://github.com/hafiz-m-awais/querydesk  
> **Total cost:** Free tier on all platforms.

---

## Architecture

```
Students / Instructors (browser)
        │ HTTPS fetch()
        ▼
  GitHub Pages          ← index.html / admin.html / directory.html
        │ REST API calls (Authorization: Bearer …)
        ▼
  Render Web Service    ← backend/  (FastAPI, uvicorn)
        │ asyncpg
        ▼
  Neon PostgreSQL       ← 7 tables, schema in backend/schema.sql
        │
  SMTP (Resend)         ← OTP emails + status-change notifications
```

---

## Prerequisites

- Python 3.11+ installed locally
- Git installed and repo cloned
- Accounts created (all free):  
  - https://neon.tech  
  - https://render.com  
  - https://resend.com (for email; 100 emails/day free)  
  - GitHub account

---

## PART 1 — Local Development (run on your machine)

### Step 1 — Create the virtual environment

```powershell
cd D:\MAIN_PROJECTS\mllab-query\mllab-query\backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2 — Create your `.env` file

```powershell
copy .env.example .env
```

Open `backend/.env` and fill in:

```ini
# PostgreSQL — use your Neon connection string (see Part 2 Step 1)
DATABASE_URL=postgresql+asyncpg://user:password@ep-xxx.neon.tech/neondb?ssl=require

# JWT — generate with: python -c "import secrets; print(secrets.token_hex(64))"
JWT_SECRET=<64-char-random-hex>
JWT_ACCESS_EXPIRE_MINUTES=480

# OTP
OTP_TTL_MINUTES=10
OTP_HMAC_SECRET=<another-random-hex>

# Email (Resend SMTP)
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=re_xxxxxxxxxxxx        # from Resend dashboard → API Keys
EMAIL_FROM=noreply@yourdomain.com

# CORS — your GitHub Pages URL
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

### Step 3 — Apply the database schema

Log in to https://console.neon.tech → open your project → **SQL Editor**, paste the entire contents of `backend/schema.sql` and run it.

Or run via psql:
```powershell
psql "<your-neon-connection-string>" -f backend/schema.sql
```

### Step 4 — Start the API server

```powershell
cd D:\MAIN_PROJECTS\mllab-query\mllab-query
.\.venv\Scripts\activate      # if not already active
uvicorn backend.main:app --reload --port 8000
```

Verify it works:
```
http://localhost:8000/health        → {"status":"ok","db":true,"version":"3.0.0"}
http://localhost:8000/docs          → Swagger UI (all endpoints)
```

### Step 5 — Open the frontend locally

Open `index.html` in VS Code → right-click → **Open with Live Server** (port 5500).

Or use Python:
```powershell
python -m http.server 5500
```

Then visit: `http://localhost:5500/index.html?api=http://localhost:8000`

> The `?api=http://localhost:8000` query param overrides `API_BASE` in `js/api.js` for local dev.

### Step 6 — Register the first instructor

```powershell
# In a new terminal (API must be running)
curl -X POST http://localhost:8000/auth/register `
  -H "Content-Type: application/json" `
  -d '{"name":"Your Name","email":"you@example.com","password":"StrongPass123!"}'
```

Or use the Swagger UI at `http://localhost:8000/docs` → `POST /auth/register`.

---

## PART 2 — Deploy to Production

### Step 1 — Set up Neon (PostgreSQL)

1. Go to https://neon.tech → **New project** → name it `querydesk`
2. **Dashboard → Connection string** → copy the `postgresql+asyncpg://...` URL  
   *(ensure `?ssl=require` is appended)*
3. Open **SQL Editor** → paste `backend/schema.sql` → **Run**

### Step 2 — Set up Resend (Email)

1. Go to https://resend.com → sign up
2. **API Keys** → **Create API Key** → copy it
3. **Domains** → add and verify your domain (or use `@resend.dev` for testing)

### Step 3 — Deploy backend to Render

1. Go to https://render.com → **New → Web Service**
2. Connect your GitHub repo `hafiz-m-awais/querydesk`
3. Configure:

   | Setting | Value |
   |---|---|
   | **Name** | `querydesk-api` |
   | **Root Directory** | *(leave blank)* |
   | **Runtime** | Python 3 |
   | **Build Command** | `pip install -r backend/requirements.txt` |
   | **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
   | **Instance Type** | Free |

4. **Environment Variables** → add all variables from your `.env` file:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Neon connection string |
   | `JWT_SECRET` | your 64-char random hex |
   | `JWT_ACCESS_EXPIRE_MINUTES` | `480` |
   | `OTP_TTL_MINUTES` | `10` |
   | `OTP_HMAC_SECRET` | your random hex |
   | `SMTP_HOST` | `smtp.resend.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `resend` |
   | `SMTP_PASSWORD` | your Resend API key |
   | `EMAIL_FROM` | `noreply@yourdomain.com` |
   | `CORS_ORIGINS` | `https://hafiz-m-awais.github.io` |
   | `RATE_LIMIT_ENABLED` | `true` |

5. Click **Create Web Service** → wait ~3 minutes for first deploy
6. Your API URL will be: `https://querydesk-api.onrender.com`
7. Verify: `https://querydesk-api.onrender.com/health`

### Step 4 — Update API_BASE in the frontend

Open `js/api.js` — change line 1:

```javascript
var API_BASE = 'https://querydesk-api.onrender.com';   // ← your Render URL
```

Then commit and push:
```powershell
cd D:\MAIN_PROJECTS\mllab-query\mllab-query
git add js/api.js
git commit -m "config: set production API_BASE to Render URL"
git push origin main
```

### Step 5 — Enable GitHub Pages

1. GitHub → your repo → **Settings → Pages**
2. **Source:** Deploy from a branch → branch: `main` → folder: `/ (root)`
3. Click **Save** → wait 1–2 minutes
4. Your frontend URL: `https://hafiz-m-awais.github.io/querydesk/`

### Step 6 — Register the first instructor (production)

```powershell
curl -X POST https://querydesk-api.onrender.com/auth/register `
  -H "Content-Type: application/json" `
  -d '{"name":"Hafiz M Awais","email":"you@example.com","password":"StrongPass123!"}'
```

Or use `https://querydesk-api.onrender.com/docs`.

### Step 7 — Create the first course

```powershell
# First login to get a token
$resp = Invoke-RestMethod -Method POST `
  -Uri "https://querydesk-api.onrender.com/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"you@example.com","password":"StrongPass123!"}'
$token = $resp.access_token

# Create a course
Invoke-RestMethod -Method POST `
  -Uri "https://querydesk-api.onrender.com/courses" `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body '{"name":"ML for Business Analytics","semester":"Spring 2026","email_pattern":"^[^\\s@]+@nu\\.edu\\.pk$","roll_pattern":"^\\d{2}[IKJ]-\\d{4}$"}'
```

The response includes the `id` (UUID) of the new course.  
Student form link: `https://hafiz-m-awais.github.io/querydesk/index.html?course=<UUID>`  
Directory page: `https://hafiz-m-awais.github.io/querydesk/directory.html`

---

## PART 3 — Common Operations

### Re-deploy after code changes

```powershell
git add .
git commit -m "your message"
git push origin main
```

Render auto-deploys from `main` within ~2 minutes. GitHub Pages auto-deploys within ~1 minute.

### Check logs on Render

Render dashboard → your service → **Logs** tab (live streaming).

### Run database migrations

After schema changes: paste new SQL into the Neon SQL Editor and run it, or use psql:
```powershell
psql "<neon-connection-string>" -c "ALTER TABLE ..."
```

### Reset a forgotten instructor password

```powershell
# Connect to Neon SQL Editor and run:
UPDATE instructors
SET password_hash = '<new-bcrypt-hash>'
WHERE email = 'you@example.com';
```

Generate a bcrypt hash locally:
```powershell
cd backend ; .\.venv\Scripts\activate
python -c "from backend.auth import hash_password; print(hash_password('NewPassword123!'))"
```

---

## PART 4 — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` returns `{"db":false}` | Wrong `DATABASE_URL` or SSL missing | Add `?ssl=require` to URL; check Neon is active |
| `401 Unauthorized` on all requests | `JWT_SECRET` mismatch | Make sure `.env` and Render env vars use the same secret |
| OTP email never arrives | SMTP config wrong | Check `SMTP_PASSWORD` is the Resend API key; verify `EMAIL_FROM` domain |
| `429 Too Many Requests` | Rate limit hit | Wait 1 minute; or set `RATE_LIMIT_ENABLED=false` for testing |
| Render cold start (~30s) | Free tier sleeps after 15 min | Upgrade to Starter ($7/mo) or ping `/health` every 14 min via a cron job |
| CORS error in browser | `CORS_ORIGINS` missing your Pages URL | Add `https://hafiz-m-awais.github.io` to `CORS_ORIGINS` in Render env vars |
| `409 Duplicate submission` | Same query submitted twice fast | Expected behaviour — wait 5 minutes or the student form shows this message |
| `422 roll number format` | `roll_pattern` regex doesn't match | Test regex at regex101.com; update via `PATCH /courses/{id}` |

      +------------+----------+---------+
                   |          |
         Google Apps Script  (/exec)
                   |
           +-------+-------+-------+
           |               |       |
       G. Sheets       G. Drive  MailApp
       (Queries tab)   (files)   (alerts)
```

---

## Files you will touch

| File            | What to change |
|-----------------|---------------|
| `gas/Config.gs` | Course defaults (optional — can use admin panel instead) |
| `js/api.js`     | Paste your GAS deployment URL |
| `gas/*.gs`      | Upload all 6 files to Apps Script editor |

---

## STEP 1 — Create a Google Sheet

1. Go to https://sheets.google.com -> **Blank spreadsheet**
2. Rename it, e.g. **"QueryDesk Spring 2026"**
3. Leave the first tab as-is (script creates the "Queries" tab automatically)

---

## STEP 2 — Set up Google Apps Script

1. In your Sheet: **Extensions -> Apps Script**
2. Delete the default `Code.gs` file (right-click -> Delete)
3. Create **6 new script files** — click **+** (Files) -> Script for each:

   | New file name  | Paste contents of       |
   |---------------|------------------------|
   | `Config`      | `gas/Config.gs`        |
   | `GetHandlers` | `gas/GetHandlers.gs`   |
   | `PostHandlers`| `gas/PostHandlers.gs`  |
   | `SheetUtils`  | `gas/SheetUtils.gs`    |
   | `DriveUtils`  | `gas/DriveUtils.gs`    |
   | `EmailUtils`  | `gas/EmailUtils.gs`    |

4. Press **Ctrl+S** after each. Name the project **"QueryDesk"**

---

## STEP 3 — Set script properties (password + email)

Script Properties store secrets securely — they never appear in source code.

1. Apps Script editor -> **Project Settings** (gear icon, left sidebar)
2. Scroll to **Script Properties** -> **Add script property**
3. Add two properties:

   | Property           | Value                                      |
   |--------------------|-------------------------------------------|
   | `ADMIN_PASSWORD`   | Strong password for the admin panel login |
   | `INSTRUCTOR_EMAIL` | Your email (receives query alert emails)  |

4. Click **Save script properties**

---

## STEP 4 — Deploy as Web App

1. Click **Deploy** (top right) -> **New deployment**
2. Click the gear next to "Select type" -> **Web app**
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy** -> authorize when prompted
5. **Copy the Web App URL** (looks like `https://script.google.com/macros/s/AKfycbw.../exec`)

---

## STEP 5 — Paste the URL into js/api.js

Open `js/api.js` and replace the URL on line 7-8:

```js
var SCRIPT_URL = _gsParam
  ? decodeURIComponent(_gsParam)
  : 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Save the file.

---

## STEP 6 — Push updated URL to GitHub

```bash
git add js/api.js
git commit -m "config: set GAS deployment URL"
git push
```

---

## STEP 7 — Enable GitHub Pages

1. Go to https://github.com/hafiz-m-awais/querydesk/settings/pages
2. **Source:** Deploy from a branch
3. **Branch:** main / (root) -> **Save**

Live URLs (ready in ~1 minute):

| Page             | URL                                                              |
|------------------|------------------------------------------------------------------|
| Student form     | https://hafiz-m-awais.github.io/querydesk/                       |
| Admin panel      | https://hafiz-m-awais.github.io/querydesk/admin.html             |
| Course directory | https://hafiz-m-awais.github.io/querydesk/directory.html         |

---

## STEP 8 — Configure your course (admin panel)

1. Open the admin panel URL above
2. Log in with your `ADMIN_PASSWORD`
3. Click **Settings**
4. Fill in:
   - **Course Name** and **Term**
   - **Sections** (comma-separated, e.g. `BSBA-6A, BSBA-6B, MSBA`)
   - **University Name** (shown in student form top-bar)
   - **Email Domain** (e.g. `nu.edu.pk`)
   - **Roll Format** (regex, e.g. `\d{2}[IKik]-\d{4}` — leave blank for any format)
   - **Submissions Open** toggle and **Announcement** text
5. Click **Save settings**

---

## STEP 9 — Test end-to-end

1. Open the **student form** and submit a test query
2. Check your **Google Sheet** — a new row should appear in the "Queries" tab
3. Open the **admin panel** -> the query appears in the table
4. Click **Review** -> change status to Resolved -> Save
5. Check your inbox for the notification email (if INSTRUCTOR_EMAIL is set)

---

## Redeploy GAS after code changes

Whenever you edit any `gas/*.gs` file you must create a **new deployment** (not redeploy):

1. Apps Script -> **Deploy -> New deployment** (same settings)
2. Copy the **new URL** -> update `js/api.js` -> commit & push

---

## Multi-instructor setup

Each instructor gets their own Google Sheet + GAS deployment. The shared frontend
selects the right backend via the `?gs=` URL parameter.

**Per-instructor setup:**
1. Follow Steps 1-4 above to get a personal GAS URL
2. Encode it in a browser console: `encodeURIComponent('https://script.google.com/macros/s/.../exec')`
3. Student link: `https://hafiz-m-awais.github.io/querydesk/?gs=ENCODED_URL`
4. Admin link:   `https://hafiz-m-awais.github.io/querydesk/admin.html?gs=ENCODED_URL`

**Add course to directory.html** — find the `COURSES` array and add:

```js
{
  name:       'Data Structures',
  instructor: 'Dr. Fatima',
  dept:       'CS',
  term:       'Spring 2026',
  sections:   ['CS-4A', 'CS-4B'],
  gasUrl:     'https://script.google.com/macros/s/AKfycbx.../exec'
}
```

Commit and push — the directory updates immediately.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Submissions not in Sheet | Create a **new** deployment; ensure "Who has access: Anyone" |
| Admin shows "Network error" | Check SCRIPT_URL in `js/api.js` is correct |
| "Auth failed" on login | Verify `ADMIN_PASSWORD` script property matches what you type |
| Student email rejected | Change **Email Domain** in admin Settings |
| Roll number rejected | Clear **Roll Format** in Settings to accept any format |
| Attachment not saving | Re-authorize: Deploy -> Manage deployments -> Authorize |

---

## Security

- Password stored as a **Script Property** — never in source code or git
- `.env` is gitignored
- All data lives in **your** Google account only
