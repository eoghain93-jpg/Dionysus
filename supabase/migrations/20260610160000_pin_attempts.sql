-- PIN brute-force protection state.
--
-- A 4-digit PIN behind an open CORS endpoint is brute-forceable in minutes
-- without attempt limiting. The verify-pin edge function (service role —
-- bypasses RLS) reads/writes this table to enforce: 5 failed attempts locks
-- the member's PIN for 15 minutes; a successful verify resets the counter.
--
-- One row per member, upserted on failure, deleted on success.

create table if not exists pin_attempts (
  member_id uuid primary key references members(id) on delete cascade,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- No policies declared: clients (anon or authenticated) can neither read
-- nor write attempt state — only the service role (edge function) can.
alter table pin_attempts enable row level security;
