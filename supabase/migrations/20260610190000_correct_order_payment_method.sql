-- Staff self-service payment method correction (cash <-> card).
--
-- The recurring incident: a sale gets rung as card when it was cash (or
-- vice versa). The night's cash variance is then out by exactly that
-- transaction and staff have to phone the manager. This lets them fix it
-- at the till, PIN-confirmed and audited, within tight guard rails:
--
--   - cash <-> card ONLY. Tab is excluded both ways — switching to/from
--     tab moves member balances and stays a manager-level fix.
--   - same trading day only, and only while the day is still open (no
--     z_reports row for the order's date). Once a Z report is closed and
--     emailed, changing history would silently invalidate it.
--   - every correction writes an order_corrections audit row recording
--     which staff member changed what.

create table if not exists order_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  old_method text not null,
  new_method text not null,
  staff_id uuid references members(id),
  created_at timestamptz not null default now()
);

alter table order_corrections enable row level security;
drop policy if exists "Till device full access" on order_corrections;
create policy "Till device full access" on order_corrections
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

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
  v_order_date date;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  if p_new_method not in ('cash', 'card') then
    raise exception 'corrections can only switch between cash and card';
  end if;

  -- Lock the order row so a concurrent correction can't double-apply
  select payment_method, (created_at at time zone 'UTC')::date
    into v_old_method, v_order_date
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

  -- Same trading day: order date conventions match the Z report (UTC date)
  if v_order_date <> (now() at time zone 'UTC')::date then
    raise exception 'only today''s sales can be corrected — ask the manager';
  end if;

  -- Day must still be open: a z_reports row for the date means the day was
  -- closed and the figures have already been reconciled and emailed
  if exists (select 1 from z_reports where report_date = v_order_date) then
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
