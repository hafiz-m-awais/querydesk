# ML Lab Query System
### FAST-NUCES Islamabad · ML for Business Analytics

A lightweight, serverless query submission and tracking system for students. Built with Google Apps Script (backend), Google Sheets (database), Google Drive (file storage), and GitHub Pages (hosting). No server required.

---

## Live URLs

| Page | URL |
|------|-----|
| Student form | https://hafiz-m-awais.github.io/mllab-query/ |
| Admin panel  | https://hafiz-m-awais.github.io/mllab-query/admin.html |

---

## System Overview

```
Student (browser)
    │  POST /exec  (fetch, no-cors, JSON payload)
    │  GET  /exec  (JSONP — status tracker & settings)
    ▼
Google Apps Script  (Code.gs)
    │  appendRow()        → Google Sheets  (Queries tab)
    │  DriveApp           → Google Drive   (ML Lab Query Attachments folder)
    └  MailApp            → Instructor email
```

---

## File Structure

```
index.html   Student-facing 3-step query wizard + status tracker
admin.html   Instructor login + query management panel
Code.gs      Google Apps Script backend (paste into GAS editor)
DEPLOY.md    Step-by-step deployment guide
README.md    This file
```

---

## Features

### Student Form (`index.html`)

- **3-step wizard** — personal details → query details → review & submit
- **Query types**: Attendance, Lab Marks, Assignment, Final Exam, Project marks
- **Multi-query**: student can submit multiple query types in one form submission
- **Lab chip selector**: for attendance/marks, choose one or more lab numbers (1–14); each lab gets its own date and detail fields
- **File attachment**: attach any file up to 5 MB — uploaded to Google Drive, linked in the sheet
- **Urgent flag**: red toggle marks a query as time-sensitive; adds `[URGENT]` to the instructor email subject
- **Status tracker**: enter roll number to see all past queries with status and instructor comments
- **Rate limiting**: max 5 submissions per hour per device (stored in `localStorage` key `mllab_v2`)
- **Honeypot**: hidden `#hp` field silently blocks simple bots
- **Input validation**:
  - Email: `i` or `k` + year 20–26 + 4 digits + `@isb.nu.edu.pk` or `@nu.edu.pk`
  - Roll number: `23I-1234` or `23K-1234` format
  - Description: minimum 15 characters per query

### Admin Panel (`admin.html`)

- **Password login** — password stored in GAS Script Properties (`ADMIN_PASSWORD`)
- **Query table** with columns: timestamp, student, roll, section, type, lab, status, urgent badge
- **Review modal** — full query details, attachment link (Drive), status dropdown, notes textarea
- **Status flow**: Pending → Reviewing → Resolved / Rejected
- **Instructor notes** — visible to student in their status tracker
- **Settings panel** — enable/disable each query type live (persisted in Script Properties)
- **Export CSV** — downloads all 19 columns including attachment URL and urgent flag
- **Delete** — removes a row from the sheet permanently

### Backend (`Code.gs`)

**Endpoints (GET — public):**

| `action=` | Auth | Description |
|-----------|------|-------------|
| `getSettings` | None | Returns enabled/disabled state of each query type |
| `getStatus` | None | Returns all queries for a roll number (status + notes only) |
| `getData` | ADMIN_PASSWORD | Returns full data for admin panel |

**Endpoints (POST):**

| `action=` | Auth | Description |
|-----------|------|-------------|
| `submit` | None | Saves new query row, uploads attachment, sends email |
| `updateStatus` | ADMIN_PASSWORD | Updates status and notes columns |
| `deleteRow` | ADMIN_PASSWORD | Deletes row by reference ID |
| `saveSettings` | ADMIN_PASSWORD | Saves query type settings to Script Properties |

**Duplicate guard**: rejects a `submit` if the same roll number + query type + lab number was submitted within the last 24 hours.

---

## Google Sheet Schema

The `Queries` sheet has 19 columns, auto-created with styled headers on first run:

| # | Column | Example |
|---|--------|---------|
| A | Reference ID | `QRY-A3F9B2C` |
| B | Timestamp | `07/05/2026, 14:32:11` |
| C | Email | `k230001@isb.nu.edu.pk` |
| D | Name | `Ali Hassan` |
| E | Roll Number | `23K-0001` |
| F | Section | `BBA-6A` |
| G | Lab Number | `Lab 3, Lab 5` |
| H | Lab Date | `Lab 3: 2026-03-15 \| Lab 5: 2026-03-22` |
| I | Query Type | `marks` / `attendance` / `assignment` / `final` / `project` |
| J | Description | Student-written description (≥ 15 chars) |
| K | Extra Date | Assignment/exam/project submission date |
| L | Marks Awarded | `14` or `Lab 3: 7 \| Lab 5: 8` |
| M | Marks Expected | `20` or `Lab 3: 10 \| Lab 5: 10` |
| N | Issue / Reason | Selected issue type |
| O | Request Type | Assignment number / exam question / project title |
| P | Status | `Pending` / `Reviewing` / `Resolved` / `Rejected` |
| Q | Instructor Notes | Set by admin; shown to student |
| R | Attachment URL | Google Drive share link (or `ERROR: ...` on failure) |
| S | Urgent | `Yes` / `No` |

---

## Setup Guide

### 1 — Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank**
2. Rename the spreadsheet: **ML Lab Queries**

### 2 — Apps Script

1. **Extensions → Apps Script**
2. Delete everything → paste the full contents of `Code.gs`
3. Press **Ctrl+S**, name the project **MLLabQuery**

### 3 — Script Properties

In the GAS editor: **Project Settings → Script Properties → Add property**

| Key | Value |
|-----|-------|
| `ADMIN_PASSWORD` | Your chosen admin password |
| `INSTRUCTOR_EMAIL` | `your.email@nu.edu.pk` |

### 4 — Authorize Drive & Mail scopes

1. In the function dropdown, select **`testDriveUpload`**
2. Click **▶ Run**
3. Click **Review permissions → Allow** (grants DriveApp + MailApp)

### 5 — Deploy as Web App

1. **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **Me** · Who has access: **Anyone**
4. Click **Deploy** → copy the URL

### 6 — Update the script URL (already done in this repo)

Both `index.html` and `admin.html` contain:
```js
var SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
```
Replace with your new URL if you re-deploy to a new project.

### 7 — Re-deploy after any Code.gs change

Every time you edit `Code.gs`:
1. **Deploy → Manage deployments → ✏ Edit**
2. Version: **New version**
3. Click **Deploy**

---

## Rate Limit

Students are limited to **5 submissions per hour** per browser. To reset during testing:

```js
// Run in browser console on the student page
localStorage.removeItem('mllab_v2');
```

---

## Security Notes

| Concern | Mitigation |
|---------|------------|
| Admin password exposure | Stored in GAS Script Properties, never in source code |
| XSS in admin modal | All user content passed through `esc()` (HTML entity encoding) |
| Attachment link injection | `attachmentUrl` validated with `indexOf('https://drive.google.com/')===0` before rendering |
| Bot submissions | Honeypot field + rate limiter |
| Unauthorised data access | `getData` / `updateStatus` / `deleteRow` require correct `ADMIN_PASSWORD` |
| Student data overexposure | `getStatus` returns only status + notes — no email, attachment URL, or urgent flag |

---

## Troubleshooting

**Submissions not appearing in Sheet**
- Re-deploy as a **new version** (not just save)
- Confirm "Who has access" is **Anyone** (not "Anyone with Google account")

**File attachments not uploading**
- Run `testDriveUpload()` from the GAS editor to trigger Drive authorization
- Check the `Attachment URL` column — errors are logged there

**Emails not sending**
- Confirm `INSTRUCTOR_EMAIL` is set in Script Properties
- Run any function from GAS editor to check for authorization errors in Execution Log

**"Declaration or statement expected" in GAS editor**
- Do not paste raw emoji characters into GAS source strings — use Unicode escapes (e.g. `\u26a0` not `⚠`)

**Admin panel shows "Network error" or "Invalid password"**
- Confirm `SCRIPT_URL` in `admin.html` matches the current deployment URL
- Confirm `ADMIN_PASSWORD` Script Property matches what you type at login

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS — no frameworks, no build step |
| Backend | Google Apps Script (V8 runtime) |
| Database | Google Sheets |
| File storage | Google Drive |
| Email | Gmail via MailApp |
| Hosting | GitHub Pages |
| CORS bypass | JSONP for GET; `fetch mode:'no-cors'` for POST |
