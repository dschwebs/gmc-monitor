# GMC Monitor

Automatically detects "Product Page Unavailable" errors in Google Merchant Center and requests a website review — hourly, via GitHub Actions.

## What it does

1. Authenticates with Google Merchant API using a service account
2. Queries for all disapproved/not-eligible products
3. Checks each product for "product page unavailable" issues specifically
4. If found: requests a website review from Google + sends an email notification
5. If nothing found: exits silently

Runs **every hour** automatically. Can also be triggered manually from the GitHub Actions UI.

---

## GitHub Secrets Required

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add all five of the following:

| Secret | Value |
|---|---|
| `MERCHANT_ID` | `6278355` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full contents of your service account `.json` key file |
| `EMAIL_FROM` | `alliedsafeandvaultco@gmail.com` |
| `EMAIL_TO` | `dschwebs@safeandvaultstore.com` |
| `EMAIL_PASS` | Your 16-character Gmail App Password |

### How to add GOOGLE_SERVICE_ACCOUNT_JSON

1. Open your downloaded service account `.json` key file in a text editor
2. Select all → copy the entire contents
3. Paste it as the value for the `GOOGLE_SERVICE_ACCOUNT_JSON` secret
4. The entire JSON object (including curly braces) should be the value

---

## Setup Checklist

- [ ] Google Cloud project created (`GMC Monitor`)
- [ ] Merchant API enabled on that project
- [ ] Service account created (`gmc-monitor@...`)
- [ ] JSON key downloaded
- [ ] Service account added to GMC account (Settings → Account access → Standard role)
- [ ] Gmail App Password created for `alliedsafeandvaultco@gmail.com`
- [ ] GitHub repo created (`dschwebs/gmc-monitor`)
- [ ] All 5 secrets added to the repo
- [ ] Workflow triggered manually once to verify it works

---

## Running Manually

From GitHub: **Actions → GMC Monitor → Run workflow**

Locally (for testing):
```bash
npm install

export MERCHANT_ID=6278355
export GOOGLE_SERVICE_ACCOUNT_JSON='{ ... paste json here ... }'
export EMAIL_FROM=alliedsafeandvaultco@gmail.com
export EMAIL_TO=dschwebs@safeandvaultstore.com
export EMAIL_PASS=your-app-password

node index.js
```

---

## Schedule

Runs at the top of every hour (`0 * * * *` cron).

To change frequency, edit `.github/workflows/gmc-monitor.yml` and update the cron value:
- Every 30 min: `*/30 * * * *`
- Every 2 hours: `0 */2 * * *`
- Every 6 hours: `0 */6 * * *`

---

## Email Notifications

You'll receive an email at `dschwebs@safeandvaultstore.com` only when errors are detected. Emails include:

- Total count of affected products
- List of affected SKUs and titles (up to 50 shown)
- Timestamp of the run

No email = no errors found that hour.

---

## Troubleshooting

**Script exits with "No issues found"** — Good, no errors detected that run.

**Authentication error** — Double-check that `GOOGLE_SERVICE_ACCOUNT_JSON` contains the full JSON and that the service account email is added to GMC with Standard access.

**Email not sending** — Verify the Gmail App Password is correct and that 2-Step Verification is enabled on the Gmail account.

**Homepage claim 403 error** — The service account needs Standard (not just read) access in GMC. The script will automatically fall back to the programs re-enable method.
