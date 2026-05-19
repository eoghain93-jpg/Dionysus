-- Wallet pass auto-fire on email CHANGE (extends 20260508120000)
--
-- Previously fired only on NULL → email. This widens it to also fire when an
-- existing email is replaced with a different one (typo fix, member moves to
-- a new address). Same-value re-saves still skip — Postgres only invokes the
-- trigger when the column actually changes, but we add an explicit `OLD.email
-- IS DISTINCT FROM NEW.email` guard for defensive clarity.

create or replace function trigger_wallet_pass_on_email_add()
returns trigger
language plpgsql
security definer
as $$
declare
  v_url text := 'https://sqpokcnoefhfmcvdttqu.supabase.co/functions/v1/send-wallet-pass-email';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxcG9rY25vZWZoZm1jdmR0dHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwODE4OTIsImV4cCI6MjA4ODY1Nzg5Mn0.2klZa_WkKM49qpJRRFIXGmdPqV-cvGuqcYHkVpODrBo';
begin
  if (NEW.email is not null and NEW.email != '')
     and (OLD.email is distinct from NEW.email) then
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
