-- Who rang it, and who changed the price.
--
-- The incident (found 22 Nov): the Guinness pint's standard price went from
-- £7.40 to £6.40 — the member price — some time between 6 and 8 Nov, and
-- non-members were undercharged £1 a pint for two weeks. Nothing recorded
-- who edited the product, when, or what the price used to be, and orders
-- carried a till_id but no staff member, so there was no way to even ask
-- "who was serving".
--
-- Two parts:
--
--   1. orders.staff_id — the staff member signed in at the till when the
--      sale (or tab settlement) was rung. Threaded through
--      create_order_with_items and settle_tab.
--
--   2. product_price_changes — an append-only log written by a trigger on
--      products, so EVERY price change is captured whatever made it (the
--      Stock page, the dashboard, hand-written SQL). Records old and new
--      standard/member price, when, which till device, and which staff
--      member confirmed it.

-- ── 1. Staff member on every order ───────────────────────────────────────

-- Deliberately NOT a foreign key to members. orders already has
-- member_id -> members; a second FK to the same table makes every existing
-- PostgREST embed of orders -> members(...) ambiguous (PGRST201) — the till,
-- the reports, the monthly report and the edge functions all use that embed
-- and would break the moment this applied. Staff names are resolved by id
-- on the client instead.
alter table orders add column if not exists staff_id uuid;

comment on column orders.staff_id is
  'members.id of the staff member signed in at the till when this order was rung. No FK on purpose: a second orders->members FK would make members(...) embeds ambiguous.';

-- Full function restated with its hardening (definer, search_path, till
-- guard, revoke) per the RPC convention in this repo. Body is the
-- 20260611210000 version plus staff_id.
create or replace function create_order_with_items(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id       uuid;
  v_member_id      uuid;
  v_staff_id       uuid;
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
  -- Absent on orders queued offline by a till bundle from before this
  -- shipped; those sync with a null staff_id, as before.
  v_staff_id       := (p_order->>'staff_id')::uuid;
  v_payment_method := p_order->>'payment_method';
  v_total          := (p_order->>'total_amount')::numeric;
  v_till_id        := coalesce(p_order->>'till_id', 'till-1');
  v_status         := coalesce(p_order->>'status', 'paid');
  v_created_at     := coalesce((p_order->>'created_at')::timestamptz, now());

  insert into orders (id, member_id, staff_id, till_id, payment_method, total_amount, status, created_at)
  values (v_order_id, v_member_id, v_staff_id, v_till_id, v_payment_method, v_total, v_status, v_created_at)
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

-- settle_tab gains p_staff_id. The 4-argument version is dropped rather
-- than left as an overload so there is exactly one settle_tab; the new
-- parameter defaults to null, so a till still running the previous bundle
-- (which sends four named arguments) keeps working until it reloads.
drop function if exists settle_tab(uuid, numeric, text, text);

create or replace function settle_tab(
  p_member_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_till_id text,
  p_staff_id uuid default null
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

  insert into orders (member_id, staff_id, till_id, payment_method, total_amount, status,
                      is_tab_settlement, prev_last_settled_at)
  values (p_member_id, p_staff_id, coalesce(p_till_id, 'till-1'), p_payment_method, p_amount, 'paid',
          true, v_prev_settled);

  return v_new_balance;
end;
$$;

revoke execute on function settle_tab(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function settle_tab(uuid, numeric, text, text, uuid) to authenticated;

-- ── 2. Price change log ──────────────────────────────────────────────────

create table if not exists product_price_changes (
  id uuid primary key default gen_random_uuid(),
  -- Deferred so the trigger can log a brand-new product's opening prices
  -- from BEFORE INSERT, before the products row itself exists.
  product_id uuid not null references products(id) on delete cascade
    deferrable initially deferred,
  -- Null on the first row for a product (its opening prices).
  old_standard_price numeric(10,2),
  new_standard_price numeric(10,2) not null,
  old_member_price numeric(10,2),
  new_member_price numeric(10,2) not null,
  -- Staff member who confirmed the change with their PIN. Null when the
  -- change didn't come from the Stock page (dashboard, SQL, old bundle).
  staff_id uuid references members(id),
  -- Which till device made the change, from its sign-in. Null for changes
  -- made outside the till (dashboard / service role).
  till_id text,
  changed_at timestamptz not null default now()
);

create index if not exists product_price_changes_changed_at_idx
  on product_price_changes (changed_at desc);
create index if not exists product_price_changes_product_idx
  on product_price_changes (product_id, changed_at desc);

alter table product_price_changes enable row level security;

-- Read-only for tills. No insert/update/delete policy on purpose: only the
-- trigger (security definer) writes rows, so the log can't be edited or
-- cleared from a till.
drop policy if exists "Till device read" on product_price_changes;
create policy "Till device read" on product_price_changes
  for select to authenticated
  using (is_till_device(auth.uid()));

-- products.changed_by is a pass-through, not stored state. The Stock page
-- sends the confirming staff member's id in it alongside the new prices;
-- the trigger copies it into the log and then blanks it, so it can never go
-- stale and wrongly pin a later change (made some other way) on the last
-- person who used the form.
alter table products add column if not exists changed_by uuid;

comment on column products.changed_by is
  'Write-only pass-through for the price change log: set it in the same UPDATE as a price change. The trigger records it in product_price_changes and resets it to null.';

create or replace function log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_till_id text;
begin
  if TG_OP = 'INSERT'
     or NEW.standard_price is distinct from OLD.standard_price
     or NEW.member_price is distinct from OLD.member_price
  then
    select till_id into v_till_id from till_devices where auth_user_id = auth.uid();

    insert into product_price_changes (
      product_id,
      old_standard_price, new_standard_price,
      old_member_price, new_member_price,
      staff_id, till_id
    )
    values (
      NEW.id,
      case when TG_OP = 'UPDATE' then OLD.standard_price end, NEW.standard_price,
      case when TG_OP = 'UPDATE' then OLD.member_price end, NEW.member_price,
      -- A stale client could send an id that isn't a member; log the change
      -- without a name rather than fail the price update on the FK.
      (select m.id from members m where m.id = NEW.changed_by),
      v_till_id
    );
  end if;

  NEW.changed_by := null;
  return NEW;
end;
$$;

revoke execute on function log_product_price_change() from public, anon, authenticated;

-- Column-scoped so the stock-movement trigger's constant
-- "update products set stock_quantity = ..." doesn't pay for this.
drop trigger if exists products_log_price_change on products;
create trigger products_log_price_change
  before insert or update of standard_price, member_price, changed_by on products
  for each row execute function log_product_price_change();

-- Baseline: one row per product with today's prices, so the log shows what
-- each price was when logging began (old_* null = opening entry).
insert into product_price_changes (product_id, new_standard_price, new_member_price)
select p.id, p.standard_price, p.member_price
from products p
where not exists (select 1 from product_price_changes c where c.product_id = p.id);
