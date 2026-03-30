-- supabase/migrations/20260330_z_reports.sql

create table if not exists z_reports (
  id          uuid        primary key default gen_random_uuid(),
  report_date date        not null unique,
  opening_float numeric(10,2) not null default 0,
  actual_cash   numeric(10,2),
  closed_at   timestamptz,
  closed_by   uuid        references members(id)
);

-- RLS: service_role inserts only; no member-facing reads needed
alter table z_reports enable row level security;
