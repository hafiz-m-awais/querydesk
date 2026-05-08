# QueryDesk — Step-by-Step Deployment Guide

> **Repo:** https://github.com/hafiz-m-awais/querydesk  
> **Stack:** Google Apps Script (backend) · Google Sheets (database) · GitHub Pages (hosting)  
> No server, no paid services — everything runs for free.

---

## Architecture

```
Student browser                   Admin browser
      |                                 |
      |  POST (no-cors)   GET (JSONP)   |
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
