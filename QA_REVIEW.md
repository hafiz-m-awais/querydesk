# QueryDesk — Senior Engineer & QA Review
**Date:** May 9, 2026  
**Reviewer role:** Senior Software Engineer + Quality Analyst  
**Context:** Evaluating fitness for university-wide, multi-instructor deployment

---

## Table of Contents
1. [Critical Issues](#1-critical-issues)
2. [Security Issues](#2-security-issues)
3. [Hardcoded Institutional Values](#3-hardcoded-institutional-values)
4. [Architecture Flaws](#4-architecture-flaws)
5. [Code Quality](#5-code-quality)
6. [Missing Features](#6-missing-features)
7. [UI/UX Issues](#7-uiux-issues)
8. [Technology Assessment](#8-technology-assessment)
9. [Overall Ratings](#9-overall-ratings)
10. [Recommended Next Steps](#10-recommended-next-steps)

---

## 1. Critical Issues

These are blockers for any institutional deployment.

### 1.1 Password Transmitted as a URL Query Parameter
**Severity: Critical**  
Every admin action sends:
```
?action=getData&password=YourPassword
```
Passwords in URLs are recorded in:
- Browser history (visible to anyone who picks up the device)
- Proxy / CDN / server access logs
- Browser autocomplete
- Referrer headers when following outbound links

This violates **OWASP A02: Cryptographic Failures** and is a fundamental security flaw. Passwords must never appear in a URL.

**Fix:** Use a `POST` body or a session token issued on login.

---

### 1.2 Real Password in `.env` File on Disk
**Severity: Critical**  
```
ADMIN_PASSWORD=@wA!$231347
```
The `.env` file is gitignored but lives on disk. A single accidental `git add .` or misconfigured `.gitignore` pushes this credential to GitHub permanently (git history cannot be easily cleaned without a force-push to all branches).

**Fix:** Remove from `.env`. Store only in GAS Script Properties. Never write credentials to any local file.

---

### 1.3 Zero Student Privacy on Status Tracker
**Severity: Critical**  
Any student can enter any other student's roll number and view all their queries, marks disputes, and instructor responses. Roll numbers are not private in a university setting — they appear on timetables, attendance sheets, and class lists.

A student's marks grievances and academic complaints are sensitive personal information.

**Fix:** Require email OTP verification, or an access token mailed to the submitter's email, before showing query status.

---

### 1.4 `no-cors` POST is Fire-and-Forget
**Severity: Critical**  
`gasPost()` uses `mode: 'no-cors'`, which returns an opaque response. The frontend **cannot detect whether the POST succeeded or failed**. A student can reach the "Query submitted!" success screen while the query never reached Google Sheets.

**Fix:** Use JSONP for all operations (including writes), or proxy the POST through a server that returns a proper CORS response.

---

## 2. Security Issues

| # | Issue | File | Severity |
|---|---|---|---|
| 2.1 | Admin login link publicly visible on student form (`Instructor login →`) | `index.html` | Medium |
| 2.2 | No rate-limiting or brute-force protection on the password endpoint | `gas/GetHandlers.gs` | High |
| 2.3 | `CORS: *` on the GAS backend allows any origin to read admin data | `gas/Config.gs` | Medium |
| 2.4 | JSONP allows any page to exfiltrate data via a `<script>` injection | `api.js`, all pages | Medium |
| 2.5 | `sessionPw` stored in a plain JS variable — visible in DevTools | `admin.js` | Medium |
| 2.6 | No CSP (Content Security Policy) header on any page | All pages | Low |

---

## 3. Hardcoded Institutional Values

`index.html` was never fully genericized. These values are hardcoded and will show incorrect branding to any instructor outside FAST-NUCES Islamabad:

| Location | Hardcoded Value | Should Be |
|---|---|---|
| `index.html` top bar | `FAST-NUCES · Islamabad` | Dynamic from course settings |
| `index.html` badge | `NU email verified` | Dynamic based on `emailDomain` config |
| `index.html` hint | `Prefix i or k · Year 20–26 · @isb.nu.edu.pk or @nu.edu.pk` | Dynamic based on `rollFormat` |
| `index.html` sections | `BSBA-6A · BSBA-6B · MSBA` | Dynamic from course sections |
| `index.html` header | `Spring 2026` | Dynamic from course term |
| `admin.js` | `loadedCourse` defaults reference FAST-NUCES values | Generic empty defaults |
| `directory.html` top bar | `FAST-NUCES · Islamabad` | Dynamic or removed |

---

## 4. Architecture Flaws

### 4.1 Per-Instructor Deployment Model Does Not Scale
**Impact: High**

The current model requires each instructor to:
1. Create a Google Sheet
2. Copy 6 files into the Apps Script editor
3. Set 2 Script Properties
4. Deploy as a Web App
5. Copy the generated URL into links

At 50 instructors this means 50 separate Sheets, 50 separate GAS projects, 50 separate deployment URLs. Problems:
- IT has zero visibility or central control
- No unified reporting across the institution
- One bug fix requires all 50 instructors to redeploy
- Google per-account email quotas multiply the problem

**Fix:** One shared GAS backend, multi-tenant by `courseId`. IT deploys once, instructors register a course ID.

---

### 4.2 Two Separate Registries That Can Drift
**Impact: Medium**

`gas/Config.gs` and `gas_registry/Config.gs` are separate files with overlapping responsibilities. A fix in one is not automatically applied to the other. Over time these will diverge silently.

---

### 4.3 GAS Cold Starts With No User Feedback
**Impact: Medium**

The first request after ~15 minutes of inactivity can take 5–30 seconds. There is no user-facing message explaining the wait. Students will see a spinner and assume the app is broken.

---

### 4.4 No Pagination on Admin Table
**Impact: Medium**

The admin panel loads all rows from Google Sheets in one request. At 500+ queries (normal across a semester), this approaches the GAS 6-minute execution limit. The page will also become unusably slow.

---

### 4.5 Google Sheets Email Quota
**Impact: High**

GAS is capped at **100 outbound emails per day** on free/Workspace accounts. One instructor with 3 sections in a busy query week can easily exceed this. Queries submitted after the limit is hit will silently fail to send notifications.

---

## 5. Code Quality

| # | Issue | Location |
|---|---|---|
| 5.1 | `jsonpGet()` function is copy-pasted in 3 places | `api.js`, `directory.html`, `setup.html` |
| 5.2 | Mixed `var` (ES5) vs `const`/`let` (ES6) with no consistent standard | `api.js` vs `admin.js` |
| 5.3 | Hundreds of inline `style=""` attributes throughout `admin.html` | `admin.html` |
| 5.4 | `Code.gs` legacy monolith still at repo root alongside `gas/` folder | `/Code.gs` |
| 5.5 | `FAST_NUCES_GUIDE.md` in what should be a generic repo | `/FAST_NUCES_GUIDE.md` |
| 5.6 | Zero automated tests (unit, integration, or E2E) | Entire project |
| 5.7 | No CI/CD pipeline — all deploys are manual copy-paste | Entire project |
| 5.8 | String concatenation used to build all HTML in `directory.html` | `directory.html` |
| 5.9 | Hardcoded FAST-NUCES timezone `Asia/Karachi` in admin JS | `admin.js` |

---

## 6. Missing Features

| Feature | Impact | Notes |
|---|---|---|
| Student email notification on status change | High | Students must manually poll — no push |
| Duplicate submission guard | Medium | Same query can be submitted multiple times |
| Admin password reset / recovery | High | Forgotten password = permanently locked out |
| Query deadline / auto-close date | Medium | Admin must remember to close manually |
| Audit log | High | Required for academic integrity and disputes |
| Comment thread / reply between instructor and student | Medium | Current system is one-shot, no follow-up |
| Backend file type and size enforcement | Medium | Only enforced in the browser |
| Admin panel pagination / virtual scroll | Medium | Required at scale |
| Multi-language / RTL support | Low | Relevant for Urdu-medium universities |
| Instructor notification digest (instead of per-query email) | Medium | Reduces email noise |

---

## 7. UI/UX Issues

| # | Issue | Location | Impact |
|---|---|---|---|
| 7.1 | No confirmation dialog before deleting a query | Admin modal | High — irreversible action |
| 7.2 | No GAS cold-start warning ("first load may take 15–30 seconds") | Student form | Medium |
| 7.3 | Step 5 in setup.html is open by default, no visual distinction from steps 1–4 | `setup.html` | Low |
| 7.4 | Admin table has 10 columns — breaks on tablets and small laptops | `admin.html` | Medium |
| 7.5 | "No queries" empty state is identical to "failed to load" — no differentiation | Admin table | Medium |
| 7.6 | Success card appears but there is no way to know the actual network write succeeded (see §1.4) | `index.html` | Critical |
| 7.7 | Roll number format hint is hardcoded to FAST-NUCES format | Student form | Medium |
| 7.8 | No loading skeleton — only a spinner, jarring on slower connections | All pages | Low |

---

## 8. Technology Assessment

| Technology | Current Use | Verdict |
|---|---|---|
| **Google Apps Script** | Per-instructor backend | Correct for zero-cost, but execution limits and cold starts are real constraints |
| **Google Sheets** | Per-course database | Acceptable at <500 rows per course; wrong for centralized multi-course data |
| **JSONP** | Bypass GAS CORS | Works, but is a 2010-era workaround. XHR with proper CORS is the modern standard |
| **Vanilla JS** | All frontend logic | Good — no build pipeline needed, appropriate for project scope |
| **GitHub Pages** | Static frontend hosting | Correct choice — free, reliable, zero config |
| **Password-in-URL auth** | Admin login | Wrong for any multi-user institutional system. Should be OAuth (Google SSO) or token-based |
| **`.env` file** | Local secrets | Wrong — the GAS Script Properties vault is the correct place, not a local file |

---

## 9. Overall Ratings

| Dimension | Score | Justification |
|---|---|---|
| **Functionality** | 6 / 10 | Core submission flow works; missing status notifications, duplicate guard, audit log |
| **Security** | 3 / 10 | Password in URLs, no privacy guardrails, no brute-force protection |
| **Scalability** | 2 / 10 | Per-instructor deployment model is a fundamental blocker at institutional scale |
| **Code Quality** | 5 / 10 | Readable and documented but inconsistent, duplicated helpers, hardcoded values |
| **UI / UX** | 7 / 10 | Clean, modern design with good visual hierarchy; fails on mobile edge cases and error states |
| **Architecture** | 4 / 10 | Works for one instructor; not designed for 50 |

### Overall: **4.5 / 10** for institutional deployment

> As a personal tool for a single instructor at one university: **7 / 10** — it works well and looks polished.  
> For multi-instructor, university-wide deployment: the security, scalability, and genericization gaps must be resolved first.

---

## 10. Recommended Next Steps

### Phase 1 — Security (Do Now)
- [ ] Move password verification to a `POST` body, never a URL parameter
- [ ] Delete `.env`. All secrets live in GAS Script Properties only
- [ ] Add roll-number OTP or email token before exposing query status to a student
- [ ] Confirm all write operations (form submit) via JSONP response, not `no-cors` POST

### Phase 2 — Genericize (Before Sharing With Other Instructors)
- [ ] Remove all FAST-NUCES, NU email, BSBA/MSBA, and `Asia/Karachi` hardcoded values from `index.html` and `admin.js`
- [ ] Remove `FAST_NUCES_GUIDE.md` or replace with a generic equivalent
- [ ] Remove `Code.gs` legacy file

### Phase 3 — Architecture (Before 10+ Instructors)
- [ ] Redesign to multi-tenant: one shared GAS deployment, courses namespaced by `courseId`
- [ ] IT deploys once; instructors register via a form and receive a `courseId`
- [ ] Replace per-URL links (`?gs=...`) with `?course=ID`

### Phase 4 — Features & Scale
- [ ] Student email notification when query status changes
- [ ] Duplicate submission guard (hash of email + query type + session)
- [ ] Admin pagination
- [ ] Audit log tab in Google Sheets
- [ ] Admin delete confirmation dialog
- [ ] GAS cold-start user message
