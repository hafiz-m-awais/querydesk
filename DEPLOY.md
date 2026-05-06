# ML Lab Query System — Deployment Guide
## FAST-NUCES Islamabad · ML for Business Analytics

---

## What you get

| File        | Purpose |
|-------------|---------|
| `index.html`| Student-facing query form |
| `admin.html`| Your private admin panel (view + update status) |
| `Code.gs`   | Google Apps Script backend (paste into Google Sheets) |

---

## STEP 1 — Set up Google Sheets

1. Go to **sheets.google.com** → click **Blank**
2. Rename the spreadsheet: **"ML Lab Queries"**
3. Leave it open — you'll come back here

---

## STEP 2 — Set up Apps Script

1. In your spreadsheet: **Extensions → Apps Script**
2. Delete everything in the editor
3. Open `Code.gs` from this folder and **paste the entire contents**
4. At the top of the script, change:
   ```
   var ADMIN_PASSWORD = 'YOUR_ADMIN_PASSWORD_HERE';
   ```
   to a strong password you'll remember, e.g.:
   ```
   var ADMIN_PASSWORD = 'FastML2025!';
   ```
5. Press **Ctrl+S** (or ⌘+S), name the project **"MLLabQuery"**

---

## STEP 3 — Deploy as Web App

1. Click **Deploy** (top right) → **New deployment**
2. Click the **gear icon ⚙** next to "Select type" → choose **Web app**
3. Fill in:
   - **Description:** ML Lab Query API
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
4. Click **Deploy**
5. Google will ask you to **Authorize** — click through and allow
6. **Copy the Web App URL** — it looks like:
   `https://script.google.com/macros/s/AKfy.../exec`

---

## STEP 4 — Paste the URL into both HTML files

Open **`index.html`** and find:
```
const SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
```
Replace with your URL.

Open **`admin.html`** and find both:
```
const SCRIPT_URL     = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
const ADMIN_PASSWORD = 'YOUR_ADMIN_PASSWORD_HERE';
```
Replace with your URL **and the same password** you set in Code.gs.

---

## STEP 5 — Host on GitHub Pages (free, 2 minutes)

1. Go to **github.com** → sign in or create free account
2. Click **New repository**
   - Name: `mllab-queries`
   - Visibility: **Private** (recommended)
   - Click **Create repository**
3. Upload **`index.html`** and **`admin.html`** (drag and drop)
4. Go to **Settings → Pages**
5. Source: **Deploy from a branch** → Branch: **main** → **Save**
6. Your URLs will be:
   - Students: `https://yourusername.github.io/mllab-queries/`
   - Admin:    `https://yourusername.github.io/mllab-queries/admin.html`

---

## STEP 6 — Share with students

- Post the **student URL** on LMS / WhatsApp group
- Keep the **admin URL** private (password protected)
- Bookmark admin.html for yourself

---

## Viewing submissions (Admin panel)

1. Open `admin.html` in your browser
2. Enter your admin password
3. All submissions appear in the table
4. Click **Review** on any query to:
   - See full details
   - Change status: **Pending → Reviewing → Resolved / Rejected**
   - Add instructor notes
5. Use filters to sort by section, lab, status, or query type
6. Click **Export CSV** to download all data for record-keeping

---

## Enabling instructor email alerts (optional)

In `Code.gs`, find the commented block:
```javascript
/*
MailApp.sendEmail({
  to: 'your.email@nu.edu.pk',
  ...
*/
```
Uncomment it and fill in your email. You'll get an email every time a student submits.

---

## Security summary

| Feature | Detail |
|---------|--------|
| Email validation | Only i/k + year 20–26 + 4 digits + @isb.nu.edu.pk or @nu.edu.pk |
| Roll number format | 23I-1234 or 23K-1234 |
| Honeypot field | Hidden field blocks simple bots |
| Rate limiting | Max 3 submissions per hour per device |
| Admin panel | Password protected — only you can view/update |
| Google Sheets | Only accessible from your Google account |

---

## Troubleshooting

**Submissions not appearing in Sheet?**
- Re-deploy the Apps Script as a new deployment (not redeploy — create new)
- Make sure "Who has access" is set to **Anyone**

**Admin panel shows "Network error"?**
- Check that SCRIPT_URL is correct in admin.html
- Check that the Apps Script is deployed (not just saved)

**Want to change sections or labs?**
- Edit the `<option>` tags in `index.html` and `admin.html` directly

---

*Generated for Awais — FAST-NUCES Islamabad, Department of Management*
