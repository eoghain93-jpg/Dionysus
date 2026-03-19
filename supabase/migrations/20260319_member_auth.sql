-- supabase/migrations/20260319_member_auth.sql

-- Link members to Supabase Auth users
alter table members add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists members_auth_user_id_idx on members(auth_user_id);

-- Track Stripe tab payments (top-ups from companion app)
create table if not exists tab_payments (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id),
  amount numeric(10,2) not null,
  stripe_payment_intent_id text unique not null,
  created_at timestamptz default now()
);

alter table tab_payments enable row level security;

-- RLS: members can only read their own member row
drop policy if exists "Allow all" on members;
create policy "Staff full access" on members
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own row" on members
  for select
  using (auth_user_id = auth.uid());

-- RLS: members can only read their own orders
drop policy if exists "Allow all" on orders;
create policy "Staff full access" on orders
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own orders" on orders
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- RLS: members can only read their own tab_payments
create policy "Member read own payments" on tab_payments
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- Service role full access on tab_payments
create policy "Staff full access" on tab_payments
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- RLS: order_items — members can read items for their own orders
drop policy if exists "Allow all" on order_items;
create policy "Staff full access" on order_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own order items" on order_items
  for select
  using (order_id in (
    select id from orders where member_id = (
      select id from members where auth_user_id = auth.uid()
    )
  ));
