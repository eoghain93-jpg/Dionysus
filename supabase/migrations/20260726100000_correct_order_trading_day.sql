-- Align correct_order_payment_method with the trading day (06:00–06:00 UTC).
--
-- The till now reports in trading days (src/lib/tradingDay.js): a session
-- that runs past midnight counts toward the night it started. The Fix
-- Payment list shows the whole session, so the RPC's guards must agree:
--
--   - "same trading day" previously compared UTC calendar dates, which
--     rejected fixing a 11:55pm sale at 12:30am mid-session.
--   - the "day already closed" check compared z_reports.report_date to the
--     order's CALENDAR date, but Z reports are stored under the TRADING
--     date — an after-midnight order could be edited after its session's
--     Z report had been closed and emailed.
--
-- Both now use the trading date: (ts at time zone 'UTC' - interval '6 hours')::date.
-- Full function restated with its hardening (definer, search_path, revoke)
-- because CREATE OR REPLACE silently resets none of it by itself — see the
-- RPC hardening convention used across this repo.

create or replace function correct_order_payment_method(
  p_order_id uuid,
  p_new_method text,
  p_staff_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_method text;
  v_trading_date date;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  if p_new_method not in ('cash', 'card') then
    raise exception 'corrections can only switch between cash and card';
  end if;

  -- Lock the order row so a concurrent correction can't double-apply.
  -- Trading day: 06:00–06:00 UTC, matching src/lib/tradingDay.js.
  select payment_method, ((created_at at time zone 'UTC') - interval '6 hours')::date
    into v_old_method, v_trading_date
    from orders
    where id = p_order_id and status = 'paid'
    for update;

  if v_old_method is null then
    raise exception 'order not found or not a paid order';
  end if;

  if v_old_method not in ('cash', 'card') then
    raise exception 'tab orders cannot be corrected from the till — ask the manager';
  end if;

  if v_old_method = p_new_method then
    raise exception 'order is already %', p_new_method;
  end if;

  -- Same trading day: at 1am on a match night, tonight's sales (including
  -- pre-midnight ones) are still correctable
  if v_trading_date <> ((now() at time zone 'UTC') - interval '6 hours')::date then
    raise exception 'only today''s sales can be corrected — ask the manager';
  end if;

  -- Day must still be open: Z reports are stored under the trading date
  if exists (select 1 from z_reports where report_date = v_trading_date) then
    raise exception 'today has already been closed — ask the manager';
  end if;

  update orders set payment_method = p_new_method where id = p_order_id;

  insert into order_corrections (order_id, old_method, new_method, staff_id)
  values (p_order_id, v_old_method, p_new_method, p_staff_id);

  return v_old_method;
end;
$$;

revoke execute on function correct_order_payment_method(uuid, text, uuid) from public, anon;
grant execute on function correct_order_payment_method(uuid, text, uuid) to authenticated;
