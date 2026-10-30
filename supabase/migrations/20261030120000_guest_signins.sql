-- Guest book: non-members signed in by a member.
--
-- A members' club can only admit non-members as the guest of a member, and
-- the licence expects a record of who came in and who signed them in. This
-- replaces the paper visitors' book behind the bar.
--
-- One row per guest per visit. member_id is the member vouching for the
-- guest; staff_id is whoever was logged in at the till when they signed in.

create table if not exists guest_signins (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (length(btrim(guest_name)) > 0),
  member_id uuid not null references members(id),
  staff_id uuid references members(id),
  till_id text not null default 'till-1',
  created_at timestamptz not null default now()
);

create index if not exists guest_signins_created_at_idx on guest_signins (created_at);

alter table guest_signins enable row level security;

drop policy if exists "Till device full access" on guest_signins;
create policy "Till device full access" on guest_signins
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));
