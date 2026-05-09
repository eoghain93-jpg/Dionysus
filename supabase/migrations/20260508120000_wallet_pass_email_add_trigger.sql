-- Wallet pass auto-fire on email-add (server-side trigger)
--
-- When a member's email transitions from NULL/empty to a real address — no
-- matter which client made the change (till app, dashboard, raw SQL, future
-- self-service form) — automatically invoke the send-wallet-pass-email edge
-- function. Closes a gap where the till's JS-side auto-fire only ran when the
-- staff member's till had the latest deploy cached.
--
-- INSERT cases (brand new members with an email) are still handled by the
-- till's upsertMember function so we don't double-send. The trigger here only
-- fires on UPDATE.
--
-- Note: the anon key is intentionally embedded — it is the same public key
-- shipped in the client bundle. Authorisation comes from RLS / function logic.

create extension if not exists pg_net;

create or replace function trigger_wallet_pass_on_email_add()
returns trigger
language plpgsql
security definer
as $$
declare
  v_url text := 'https://sqpokcnoefhfmcvdttqu.supabase.co/functions/v1/send-wallet-pass-email';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxcG9rY25vZWZoZm1jdmR0dHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwODE4OTIsImV4cCI6MjA4ODY1Nzg5Mn0.2klZa_WkKM49qpJRRFIXGmdPqV-cvGuqcYHkVpODrBo';
begin
  -- Only fire on transitions from no-email to has-email
  if (NEW.email is not null and NEW.email != '')
     and (OLD.email is null or OLD.email = '') then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('member_id', NEW.id::text),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists wallet_pass_on_email_add on members;
create trigger wallet_pass_on_email_add
  after update of email on members
  for each row
  execute function trigger_wallet_pass_on_email_add();
