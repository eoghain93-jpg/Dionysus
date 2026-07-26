-- Move the monthly report send from 06:00 to 08:00 UTC on the 1st.
--
-- The trading month now closes at exactly 06:00 UTC on the 1st (the
-- trading-day cutoff), which was also the moment the cron fired — a
-- zero-second buffer. An order stamped during the final late session but
-- synced late (the till queues offline orders client-side with their
-- original created_at) or a checkout committing across the boundary
-- would miss the month's build and, being before the next month's
-- window, would never appear in ANY automated report. 08:00 sits inside
-- the club's never-trades 6-11am window: nothing new can be stamped
-- into the closed month between cutoff and build, and the two-hour
-- buffer absorbs in-flight commits and short offline gaps. Longer
-- outages: re-send manually from Reports → Monthly Report, or invoke
-- the edge function with { month: 'YYYY-MM' }.
--
-- cron.schedule() by name replaces the existing job — same idempotence
-- the original 20260725120000 schedule relies on.

select cron.schedule(
  'send-monthly-report',
  '0 8 1 * *',
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
