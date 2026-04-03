-- supabase/migrations/20260402_cashback_transactions.sql
create table cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount > 0),
  staff_id uuid references members(id),
  till_id text not null default 'till-1',
  created_at timestamptz default now()
);
