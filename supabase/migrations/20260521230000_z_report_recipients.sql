-- Z-report recipient list.
--
-- Replaces the MANAGER_EMAIL Supabase secret. Staff emails aren't sensitive,
-- and the secret approach made it awkward to add/remove people without CLI
-- access. This table is queryable, editable via the Supabase dashboard, and
-- visible in audit.
--
-- The send-z-report edge function reads active rows from this table and
-- falls back to MANAGER_EMAIL only if the table is empty (defensive — keeps
-- the lights on if the migration is rolled back or someone empties the table).

create table if not exists z_report_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed with the current list (kept in sync with what the MANAGER_EMAIL
-- secret was set to as of 2026-05-21). Idempotent: ON CONFLICT DO NOTHING
-- so re-running this migration doesn't duplicate rows or fail.
insert into z_report_recipients (email, name) values
  ('eoghain93@gmail.com',       'Eoghain'),
  ('nikkibeard70@gmail.com',    'Nikki Beard'),
  ('rob.m.perry@btinternet.com','Rob Perry'),
  ('shineyheadkev@gmail.com',   'Kev'),
  ('keirabet18@icloud.com',     'Keira'),
  ('brooketansley5@gmail.com',  'Brooke Tansley')
on conflict (email) do nothing;
