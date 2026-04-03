-- supabase/migrations/20260402_tab_adjustments.sql
create table tab_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  amount numeric(10,2) not null,  -- negative = reduction, positive = addition
  reason text not null,
  staff_id uuid references members(id),
  created_at timestamptz default now()
);
