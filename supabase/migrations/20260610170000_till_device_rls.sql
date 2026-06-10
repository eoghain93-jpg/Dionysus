-- RLS hardening: till device identity + lockdown of the "Allow all" era.
--
-- THE PROBLEM: the anon key ships in the deployed till bundle. With the
-- original "Allow all" policies (schema.sql) anyone extracting it could
-- read/write orders, members, stock and takings via the REST API. Several
-- newer tables (cashback_transactions, prize_wins, tab_adjustments,
-- promotions*) never had RLS enabled at all, and z_reports had RLS
-- explicitly disabled.
--
-- THE CONSTRAINT: two client apps share this database. The member app uses
-- Supabase Auth for members (read-own policies from 20260319000000), so
-- "to authenticated" is NOT sufficient for till write access — members are
-- authenticated too and must never write orders/stock/other members' rows.
--
-- THE DESIGN: each physical till signs into a dedicated Supabase auth user
-- once. till_devices maps that auth user id -> till_id, and
-- is_till_device(uid) gates every till policy. Members keep their read-own
-- policies; the anon role matches no policy anywhere and can do nothing.
--
-- ⚠ ROLLOUT ORDER (breaks the till if done out of order):
--   1. deploy the till bundle that signs in as a device (DeviceGate)
--   2. create the till auth users in the dashboard + insert till_devices rows
--   3. THEN apply this migration
-- See docs/till-device-setup.md for the full runbook.

-- ── Till device identity ─────────────────────────────────────────────────

create table if not exists till_devices (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  till_id text not null check (till_id ~ '^till-\d+$'),
  name text,
  created_at timestamptz not null default now()
);

alter table till_devices enable row level security;

-- A signed-in device may read its own row (to learn its till_id);
-- only the dashboard/service role manages the table.
drop policy if exists "Device reads own row" on till_devices;
create policy "Device reads own row" on till_devices
  for select to authenticated
  using (auth_user_id = auth.uid());

-- security definer so policies on other tables can call it without needing
-- read access to till_devices; fixed search_path prevents hijacking.
create or replace function is_till_device(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from till_devices where auth_user_id = uid);
$$;

revoke execute on function is_till_device(uuid) from public;
grant execute on function is_till_device(uuid) to authenticated, anon;

-- ── Drop the "Allow all" era ─────────────────────────────────────────────

drop policy if exists "Allow all" on members;
drop policy if exists "Allow all" on products;
drop policy if exists "Allow all" on orders;
drop policy if exists "Allow all" on order_items;
drop policy if exists "Allow all" on tabs;
drop policy if exists "Allow all" on stock_movements;
drop policy if exists "Allow all" on suppliers;
drop policy if exists "Allow all" on purchase_orders;
drop policy if exists "Allow all" on purchase_order_items;

-- ── Till-device policies ─────────────────────────────────────────────────
-- Member read-own policies from 20260319000000 stay untouched; permissive
-- policies are OR'd, so a member matches read-own and a till matches these.

-- members: till reads/writes all rows (lookup, create, tab balance via RPC,
-- last_settled_at stamping). Members keep "Member read own row".
drop policy if exists "Till device full access" on members;
create policy "Till device full access" on members
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on orders;
create policy "Till device full access" on orders
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on order_items;
create policy "Till device full access" on order_items
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on stock_movements;
create policy "Till device full access" on stock_movements
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on tabs;
create policy "Till device full access" on tabs
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on suppliers;
create policy "Till device full access" on suppliers
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on purchase_orders;
create policy "Till device full access" on purchase_orders
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device full access" on purchase_order_items;
create policy "Till device full access" on purchase_order_items
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- products: any authenticated user may read (member app shows product names
-- on order history via joins); only till devices write.
drop policy if exists "Authenticated read" on products;
create policy "Authenticated read" on products
  for select to authenticated
  using (true);

drop policy if exists "Till device write" on products;
create policy "Till device write" on products
  for insert to authenticated
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device update" on products;
create policy "Till device update" on products
  for update to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

drop policy if exists "Till device delete" on products;
create policy "Till device delete" on products
  for delete to authenticated
  using (is_till_device(auth.uid()));

-- ── Tables that never had RLS enabled ────────────────────────────────────

alter table cashback_transactions enable row level security;
drop policy if exists "Till device full access" on cashback_transactions;
create policy "Till device full access" on cashback_transactions
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

alter table prize_wins enable row level security;
drop policy if exists "Till device full access" on prize_wins;
create policy "Till device full access" on prize_wins
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

alter table tab_adjustments enable row level security;
drop policy if exists "Till device full access" on tab_adjustments;
create policy "Till device full access" on tab_adjustments
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

alter table promotions enable row level security;
drop policy if exists "Till device full access" on promotions;
create policy "Till device full access" on promotions
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

alter table promotion_items enable row level security;
drop policy if exists "Till device full access" on promotion_items;
create policy "Till device full access" on promotion_items
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

alter table promotion_categories enable row level security;
drop policy if exists "Till device full access" on promotion_categories;
create policy "Till device full access" on promotion_categories
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- ── z_reports: re-enable RLS (was disabled by 20260330000005) ────────────

alter table z_reports enable row level security;
drop policy if exists "Till device full access" on z_reports;
create policy "Till device full access" on z_reports
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- ── Harden the money-path RPCs ───────────────────────────────────────────
-- SECURITY DEFINER so they keep working as the underlying tables lock down,
-- with an explicit till-device check INSIDE the function — members are
-- authenticated and could otherwise call them. Execute revoked from anon;
-- service role / admin connections have auth.uid() null and pass.

create or replace function create_order_with_items(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id       uuid;
  v_member_id      uuid;
  v_payment_method text;
  v_total          numeric(10,2);
  v_till_id        text;
  v_status         text;
  v_created_at     timestamptz;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  v_order_id       := coalesce((p_order->>'id')::uuid, gen_random_uuid());
  v_member_id      := (p_order->>'member_id')::uuid;
  v_payment_method := p_order->>'payment_method';
  v_total          := (p_order->>'total_amount')::numeric;
  v_till_id        := coalesce(p_order->>'till_id', 'till-1');
  v_status         := coalesce(p_order->>'status', 'paid');
  v_created_at     := coalesce((p_order->>'created_at')::timestamptz, now());

  insert into orders (id, member_id, till_id, payment_method, total_amount, status, created_at)
  values (v_order_id, v_member_id, v_till_id, v_payment_method, v_total, v_status, v_created_at)
  on conflict (id) do nothing;

  if not found then
    return v_order_id;
  end if;

  insert into order_items (order_id, product_id, quantity, unit_price, member_price_applied)
  select
    v_order_id,
    (i->>'product_id')::uuid,
    (i->>'quantity')::numeric,
    (i->>'unit_price')::numeric,
    coalesce((i->>'member_price_applied')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  insert into stock_movements (product_id, type, quantity, till_id, created_at)
  select
    (i->>'product_id')::uuid,
    'sale',
    (i->>'quantity')::numeric,
    v_till_id,
    v_created_at
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where i->>'product_id' is not null;

  if v_payment_method = 'tab' and v_member_id is not null then
    update members
      set tab_balance = tab_balance + v_total
      where id = v_member_id;
  end if;

  return v_order_id;
end;
$$;

revoke execute on function create_order_with_items(jsonb, jsonb) from public, anon;
grant execute on function create_order_with_items(jsonb, jsonb) to authenticated;

create or replace function adjust_tab_balance(p_member_id uuid, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  update members
    set tab_balance = greatest(0, coalesce(tab_balance, 0) + p_delta)
    where id = p_member_id
    returning tab_balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'Member % not found', p_member_id;
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function adjust_tab_balance(uuid, numeric) from public, anon;
grant execute on function adjust_tab_balance(uuid, numeric) to authenticated;

-- Stripe webhook helpers (security definer since 20260319000000) — only the
-- service role should ever call them; they previously had PUBLIC execute.
revoke execute on function decrement_tab_balance(uuid, numeric) from public, anon, authenticated;
revoke execute on function record_tab_payment(uuid, numeric, text) from public, anon, authenticated;

-- adjust_stock (schema.sql, security invoker) is no longer called by any
-- client — sales go through the stock_movements trigger. Lock it down too.
revoke execute on function adjust_stock(uuid, numeric) from public, anon, authenticated;
