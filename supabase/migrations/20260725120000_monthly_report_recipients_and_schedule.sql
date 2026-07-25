-- Monthly accountant report: its own recipient list + automated send.
--
-- The monthly report previously fell back to z_report_recipients — the
-- STAFF list that gets the daily Z report. The accountant shouldn't get
-- daily Z reports, and staff don't need the accountant pack, so the
-- monthly report gets its own table. send-monthly-report resolves:
-- monthly_report_recipients → z_report_recipients → MANAGER_EMAIL.
--
-- The scheduled send runs at 06:00 UTC on the 1st of each month via
-- pg_cron + pg_net, calling the send-monthly-report edge function in
-- build mode (no csv in the body → the function builds last month's CSV
-- itself). The gateway wants a valid JWT (anon key), and build mode
-- additionally wants the CRON_SECRET the function holds as an env var
-- (set with `supabase secrets set CRON_SECRET=...`). Both live in Vault
-- alongside the project URL — NOT in this file:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon-key>', 'anon_key');
--   select vault.create_secret('<same CRON_SECRET value>', 'cron_secret');
-- On local staging those secrets don't exist, so the job no-ops with an
-- error in cron.job_run_details — harmless.
--
-- Idempotent throughout: CI re-runs `supabase db push` on every
-- migrations push, and cron.schedule() by name replaces the existing job.

create table if not exists monthly_report_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Same lockdown as z_report_recipients: no policies declared = anon gets
-- nothing; the edge function reads via service role, which bypasses RLS.
alter table monthly_report_recipients enable row level security;

insert into monthly_report_recipients (email, name) values
  ('kelly@trenans.co.uk', 'Kelly (accountant)')
on conflict (email) do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-monthly-report',
  '0 6 1 * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-monthly-report',
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
