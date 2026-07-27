# Scheduled jobs — ops notes

Everything automated runs as a pg_cron job in the Supabase project
(`sqpokcnoefhfmcvdttqu`) that POSTs to an edge function via pg_net. The
daily Z report is NOT one of these — it's sent by the till when staff
press Close Day (`send-z-report`).

| Job name | Schedule (UTC) | Edge function | What it does |
|---|---|---|---|
| `send-morning-check` | `30 7 * * *` (07:30 daily) | `send-morning-check` | Checks yesterday's trading day: never closed / closed without a cash count / \|variance\| > £50. Emails the manager list (`z_report_recipients`, active=true) only when something fired — silent when all is well. |
| `send-monthly-report` | `0 8 1 * *` (08:00 on the 1st) | `send-monthly-report` (build mode) | Builds last month's CSV server-side and emails the accountant list (`monthly_report_recipients`, active=true). |

Both fire inside the club's never-trades 6–11am window, after the 06:00
trading-day cutoff (`src/lib/tradingDay.js`), so nothing can still be
trading into the period being reported.

## Wiring

Each cron job reads three Vault secrets (Dashboard → Project Settings →
Vault; NOT in the repo):

- `project_url` — `https://sqpokcnoefhfmcvdttqu.supabase.co`
- `anon_key` — satisfies the edge-function gateway's JWT check
- `cron_secret` — sent as an `x-cron-secret` header; must match the
  `CRON_SECRET` function secret (`supabase secrets set CRON_SECRET=...`)

Both functions read financials, so anon alone is rejected: they require
the service-role key as bearer **or** the matching `x-cron-secret`.

Function secrets needed: `RESEND_API_KEY`, `CRON_SECRET`,
`MANAGER_EMAIL` (fallback recipient). `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Deploying

- Cron schedules live in migrations (`20260727150000_morning_check_cron.sql`,
  `20260726101000_monthly_report_cron_0800.sql`) and land via the
  migrate workflow on push to master. `cron.schedule()` by name replaces
  the existing job, so re-runs are safe.
- Edge functions are deployed manually:
  `supabase functions deploy send-morning-check` (and
  `send-monthly-report`). CI does not deploy functions.

## Checking runs

```sql
select jobname, status, return_message, start_time
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
order by start_time desc limit 20;
```

A 200-ish `net.http_post` only means the request was queued; the
function's own result is in `net._http_response` shortly after, or just
check the inbox / Resend dashboard.

## Manual runs / testing

Morning check for a specific day, without emailing:

```bash
curl -s -X POST "https://sqpokcnoefhfmcvdttqu.supabase.co/functions/v1/send-morning-check" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-24","dryRun":true}'
```

Drop `dryRun` to actually email; add `"recipientOverride":"you@example.com"`
to send only to yourself. `varianceThreshold` (default 50) overrides the
£50 alert line. The monthly report takes `{"month":"YYYY-MM","dryRun":true}`
the same way.

## Local staging

The Vault secrets don't exist locally, so both jobs no-op with an error
in `cron.job_run_details` — expected and harmless.

## Rotating CRON_SECRET

1. `supabase secrets set CRON_SECRET=<new>`
2. Update the Vault `cron_secret` to the same value.

Out of sync = both scheduled jobs get 403s until they match.
