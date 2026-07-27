-- Daily morning sanity check on yesterday's close (07:30 UTC).
--
-- Close Day problems previously surfaced weeks later in the monthly
-- accountant report: 2026-05-08 and 2026-05-24 were closed with no
-- drawer count, and the overwrites restored by 20260727130000 sat
-- unnoticed for a month. The send-morning-check edge function checks
-- the trading day that ended at the most recent 06:00 cutoff —
--   1. orders exist but no z_reports row  → day was never closed
--   2. actual_cash 0/null with cash taken → closed without a cash count
--   3. |variance| > £50                   → large variance, with figures
-- — and emails the manager list (z_report_recipients, active=true) only
-- when something fired. Silent when all is well.
--
-- 07:30 UTC sits inside the club's never-trades 6–11am window: the
-- trading day is fully closed 90 minutes before the check runs, and
-- nobody is mid-close while it looks. (On the 1st it runs alongside the
-- 08:00 monthly report send — separate functions, no interaction.)
--
-- Auth/wiring matches send-monthly-report (20260725120000): the gateway
-- takes the anon key as JWT and the function checks CRON_SECRET from the
-- x-cron-secret header. All three values come from Vault — project_url,
-- anon_key, cron_secret — already provisioned for the monthly job, so
-- there is nothing new to set up. On local staging those secrets don't
-- exist and the job no-ops with an error in cron.job_run_details.
--
-- Idempotent: cron.schedule() by name replaces the existing job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-morning-check',
  '30 7 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-morning-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $job$
);
