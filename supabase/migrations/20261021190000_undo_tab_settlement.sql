-- Undo a tab settlement from the till.
--
-- The incident (21 Oct): staff tapped "Full balance" on a £260.10 tab when
-- the customer only paid £150. The tab was zeroed, the full amount was
-- booked as card takings and last_settled_at was stamped — and the previous
-- last_settled_at was lost, so the Tabs view could no longer list the drinks
-- still owed. Fixing it took hand-written SQL.
--
-- Two parts:
--
--   1. settle_tab — the settlement becomes one atomic RPC instead of three
--      client-side writes (balance delta, last_settled_at stamp, order
--      insert). The settlement order is flagged is_tab_settlement and
--      remembers the member's last_settled_at from BEFORE the settle, so an
--      undo can restore it exactly.
--
--   2. undo_tab_settlement — PIN-gated at the till, same guard rails as
--      correct_order_payment_method: same trading day, day not yet closed.
--      Voids the settlement order (so it drops out of takings), puts the
--      amount back on the tab, restores last_settled_at and writes a
--      tab_adjustments audit row. Staff then settle the amount actually paid.
--      Only the member's latest settlement can be undone, otherwise the
--      restored last_settled_at would be stale.
--
-- Settlements made before this migration have no flag and can't be undone
-- from the till — that's a manager fix, as before.

alter table orders add column if not exists is_tab_settlement boolean not null default false;
alter table orders add column if not exists prev_last_settled_at timestamptz;

create or replace function settle_tab(
  p_member_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_till_id text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_settled timestamptz;
  v_balance numeric;
  v_new_balance numeric;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  if p_payment_method not in ('cash', 'card') then
    raise exception 'tabs can only be settled by cash or card';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a valid amount';
  end if;

  -- Lock the member row so a concurrent tab order or settle can't interleave
  select last_settled_at, coalesce(tab_balance, 0)
    into v_prev_settled, v_balance
    from members
    where id = p_member_id
    for update;

  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  -- Clamped at zero, as adjust_tab_balance. Only a FULL settlement stamps
  -- last_settled_at: a partial one leaves the tab's line items visible.
  v_new_balance := greatest(0, v_balance - p_amount);

  update members
    set tab_balance = v_new_balance,
        last_settled_at = case when v_new_balance = 0 then now() else last_settled_at end
    where id = p_member_id;

  insert into orders (member_id, till_id, payment_method, total_amount, status,
                      is_tab_settlement, prev_last_settled_at)
  values (p_member_id, coalesce(p_till_id, 'till-1'), p_payment_method, p_amount, 'paid',
          true, v_prev_settled);

  return v_new_balance;
end;
$$;

revoke execute on function settle_tab(uuid, numeric, text, text) from public, anon;
grant execute on function settle_tab(uuid, numeric, text, text) to authenticated;

create or replace function undo_tab_settlement(
  p_order_id uuid,
  p_staff_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_trading_date date;
  v_new_balance numeric;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  -- Lock the order row so a double-tap can't undo it twice
  select * into v_order
    from orders
    where id = p_order_id and status = 'paid'
    for update;

  if not found then
    raise exception 'payment not found or already undone';
  end if;

  if not v_order.is_tab_settlement or v_order.member_id is null then
    raise exception 'this sale is not a tab payment';
  end if;

  -- Trading day: 06:00–06:00 UTC, matching src/lib/tradingDay.js
  v_trading_date := ((v_order.created_at at time zone 'UTC') - interval '6 hours')::date;

  if v_trading_date <> ((now() at time zone 'UTC') - interval '6 hours')::date then
    raise exception 'only today''s tab payments can be undone — ask the manager';
  end if;

  if exists (select 1 from z_reports where report_date = v_trading_date) then
    raise exception 'today has already been closed — ask the manager';
  end if;

  perform 1 from members where id = v_order.member_id for update;

  if exists (
    select 1 from orders
    where member_id = v_order.member_id
      and is_tab_settlement
      and status = 'paid'
      and created_at > v_order.created_at
  ) then
    raise exception 'there is a later payment on this tab — undo that one first';
  end if;

  update orders set status = 'voided' where id = p_order_id;

  update members
    set tab_balance = coalesce(tab_balance, 0) + v_order.total_amount,
        last_settled_at = v_order.prev_last_settled_at
    where id = v_order.member_id
    returning tab_balance into v_new_balance;

  insert into tab_adjustments (member_id, amount, reason, staff_id)
  values (
    v_order.member_id,
    v_order.total_amount,
    format('Undid %s tab payment of £%s taken at %s',
           v_order.payment_method,
           to_char(v_order.total_amount, 'FM999990.00'),
           to_char(v_order.created_at at time zone 'Europe/London', 'HH24:MI')),
    p_staff_id
  );

  return v_new_balance;
end;
$$;

revoke execute on function undo_tab_settlement(uuid, uuid) from public, anon;
grant execute on function undo_tab_settlement(uuid, uuid) to authenticated;
