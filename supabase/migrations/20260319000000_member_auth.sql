-- supabase/migrations/20260319_member_auth.sql

-- Link members to Supabase Auth users
alter table members add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists members_auth_user_id_idx on members(auth_user_id);

-- Track Stripe tab payments (top-ups from companion app)
create table if not exists tab_payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  amount numeric(10,2) not null,
  stripe_payment_intent_id text unique not null,
  created_at timestamptz default now()
);

-- FK indexes for efficient lookups
create index if not exists orders_member_id_idx on orders(member_id);
create index if not exists tab_payments_member_id_idx on tab_payments(member_id);

-- Explicit RLS enable (service_role bypasses RLS by default; enabling here
-- ensures member-facing policies are evaluated for authenticated users)
alter table members enable row level security;
alter table orders enable row level security;
alter table tab_payments enable row level security;

-- RLS: members can only read their own member row
drop policy if exists "Allow all" on members;
drop policy if exists "Member read own row" on members;
create policy "Member read own row" on members
  for select
  using (auth_user_id = auth.uid());

-- RLS: members can only read their own orders
drop policy if exists "Allow all" on orders;
drop policy if exists "Member read own orders" on orders;
create policy "Member read own orders" on orders
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- RLS: members can only read their own tab_payments
drop policy if exists "Member read own payments" on tab_payments;
create policy "Member read own payments" on tab_payments
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- RLS: order_items — members can read items for their own orders
drop policy if exists "Allow all" on order_items;
drop policy if exists "Member read own order items" on order_items;
create policy "Member read own order items" on order_items
  for select
  using (order_id in (
    select id from orders where member_id = (
      select id from members where auth_user_id = auth.uid()
    )
  ));

-- Atomic tab balance decrement (prevents race conditions on concurrent webhook calls)
create or replace function decrement_tab_balance(p_member_id uuid, p_amount numeric)
returns void language plpgsql security definer as $$
begin
  update members
  set tab_balance = greatest(0, tab_balance - p_amount)
  where id = p_member_id;
end;
$$;

-- Atomic: record payment AND decrement balance in a single transaction
-- Prevents partial-failure state where Stripe retries but unique constraint blocks re-insert
create or replace function record_tab_payment(
  p_member_id uuid,
  p_amount numeric,
  p_stripe_payment_intent_id text
) returns void language plpgsql security definer as $$
begin
  insert into tab_payments (member_id, amount, stripe_payment_intent_id)
  values (p_member_id, p_amount, p_stripe_payment_intent_id)
  on conflict (stripe_payment_intent_id) do nothing;

  -- Only decrement if this payment_intent hasn't already been processed
  -- (on conflict do nothing means no decrement on duplicate)
  if found then
    update members
    set tab_balance = greatest(0, tab_balance - p_amount)
    where id = p_member_id;

    if not found then
      raise warning 'Member % not found when decrementing tab balance', p_member_id;
    end if;
  end if;
end;
$$;
