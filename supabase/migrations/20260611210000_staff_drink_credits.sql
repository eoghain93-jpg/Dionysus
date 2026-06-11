-- "One in for yourself" — banked staff drinks.
--
-- A customer buys a drink for a staff member as a tip. The drink is paid for
-- NOW as a normal line on the customer's order (cash/card/tab — revenue
-- counts on the day it was paid, so Z-reports and the accountant report stay
-- truthful), but the pint doesn't leave the cellar until the staff member
-- actually pours it. So:
--
--   * the order_items row carries staff_credit_for (the staff member id)
--   * NO 'sale' stock movement is written for that line at sale time
--   * a staff_drink_credits row banks the drink, one row per unit
--   * redemption (redeem_staff_drink_credit) atomically marks the credit
--     redeemed and writes a 'staff_credit_redemption' stock movement for
--     whatever was actually poured — a DISTINCT type from 'staff_drink' so
--     the comps lines on the Z-report / accountant report (which value
--     'staff_drink' rows at retail as giveaways) are not inflated by drinks
--     a customer already paid for. The apply_stock_movement trigger
--     decrements stock for it exactly like a staff_drink.
--
-- An unredeemed credit is money taken with no stock consumed, which is the
-- real-world position (the house keeps it if never claimed).

alter table order_items add column staff_credit_for uuid references members(id);

create table staff_drink_credits (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references members(id),
  product_id uuid references products(id),          -- what the customer paid for
  amount numeric(10,2) not null,                    -- price actually paid
  order_id uuid references orders(id),              -- the paying order
  status text not null default 'banked' check (status in ('banked','redeemed','cancelled')),
  created_at timestamptz default now(),
  redeemed_at timestamptz,
  redeemed_product_id uuid references products(id), -- what was actually poured
  redeemed_by uuid references members(id)           -- who was working the till and poured it
);

create index staff_drink_credits_staff_banked
  on staff_drink_credits (staff_member_id) where status = 'banked';

alter table staff_drink_credits enable row level security;

create policy "Till device full access" on staff_drink_credits
  for all
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- ── New movement type for redemptions ────────────────────────────────────
-- Distinct from 'staff_drink' (a genuine house comp) so report aggregations
-- can tell tips from giveaways. Decrements stock identically.

alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','restock','wastage','spillage','adjustment','staff_drink','staff_credit_redemption'));

create or replace function apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_delta numeric;
begin
  v_delta := case NEW.type
    when 'sale'                    then -NEW.quantity
    when 'wastage'                 then -NEW.quantity
    when 'spillage'                then -NEW.quantity
    when 'staff_drink'             then -NEW.quantity
    when 'staff_credit_redemption' then -NEW.quantity
    when 'restock'                 then  NEW.quantity
    when 'adjustment'              then  NEW.quantity
    else 0
  end;

  if v_delta <> 0 and NEW.product_id is not null then
    update products
      set stock_quantity = stock_quantity + v_delta
      where id = NEW.product_id;
  end if;
  return NEW;
end;
$$;

-- ── create_order_with_items: thread staff credits through the atomic order ──
-- Body extends the HARDENED version from 20260610170000_till_device_rls.sql
-- (security definer, pinned search_path, in-body till-device guard, no anon
-- execute) — NOT the original 20260610120000 body. The additions: order_items
-- records staff_credit_for, flagged lines are excluded from 'sale' stock
-- movements, and one banked credit row is created per unit.

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

  -- Replayed sync: the order already exists, so its items, stock movements,
  -- staff credits and tab balance were already written. Skip everything.
  if not found then
    return v_order_id;
  end if;

  insert into order_items (order_id, product_id, quantity, unit_price, member_price_applied, staff_credit_for)
  select
    v_order_id,
    (i->>'product_id')::uuid,
    (i->>'quantity')::numeric,
    (i->>'unit_price')::numeric,
    coalesce((i->>'member_price_applied')::boolean, false),
    (i->>'staff_credit_for')::uuid
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  -- Stock movement timestamps use the order's created_at so offline sales
  -- land with the time the sale actually happened, not the sync time.
  -- Staff-credit lines write NO sale movement: the stock leaves when the
  -- banked drink is poured (redeem_staff_drink_credit), not when it's paid.
  insert into stock_movements (product_id, type, quantity, till_id, created_at)
  select
    (i->>'product_id')::uuid,
    'sale',
    (i->>'quantity')::numeric,
    v_till_id,
    v_created_at
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where i->>'product_id' is not null
    and i->>'staff_credit_for' is null;

  -- Bank one credit per unit so each drink redeems individually.
  insert into staff_drink_credits (staff_member_id, product_id, amount, order_id, created_at)
  select
    (i->>'staff_credit_for')::uuid,
    (i->>'product_id')::uuid,
    (i->>'unit_price')::numeric,
    v_order_id,
    v_created_at
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  cross join generate_series(1, greatest(1, coalesce((i->>'quantity')::int, 1)))
  where i->>'staff_credit_for' is not null;

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

-- ── Atomic redemption ────────────────────────────────────────────────────
-- Marks the credit redeemed and writes the staff_credit_redemption stock
-- movement in one transaction; the status guard makes a double-tap (or a
-- replayed request) a hard error rather than a second pour. The movement's
-- member_id records WHO the drink belonged to (from the credit row, not the
-- caller) — so a credit can be redeemed by whoever is working the till on
-- behalf of an off-shift colleague sitting on the customer side, with
-- p_redeemed_by recording who actually poured it. Same hardening pattern as
-- the other money/stock RPCs (20260610170000).

create or replace function redeem_staff_drink_credit(
  p_credit_id uuid,
  p_product_id uuid,
  p_till_id text default 'till-1',
  p_redeemed_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  if p_product_id is null then
    raise exception 'product required';
  end if;

  update staff_drink_credits
     set status = 'redeemed',
         redeemed_at = now(),
         redeemed_product_id = p_product_id,
         redeemed_by = p_redeemed_by
   where id = p_credit_id
     and status = 'banked'
  returning staff_member_id into v_staff;

  if v_staff is null then
    raise exception 'Credit % not found or already redeemed', p_credit_id;
  end if;

  insert into stock_movements (product_id, type, quantity, member_id, till_id, notes)
  values (p_product_id, 'staff_credit_redemption', 1, v_staff, p_till_id,
          'Redeemed banked staff drink ' || p_credit_id);

  return p_credit_id;
end;
$$;

revoke execute on function redeem_staff_drink_credit(uuid, uuid, text, uuid) from public, anon;
grant execute on function redeem_staff_drink_credit(uuid, uuid, text, uuid) to authenticated;
