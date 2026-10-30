-- Guest records, the £2 guest fee and the 3-visit limit.
--
-- Builds on the guest book (20261030120000_guest_signins.sql):
--
--   * guests — one record per person, identified by name + date of birth
--     (name compared case- and whitespace-insensitively via name_key), so
--     repeat visits are counted against the same person.
--
--   * 3-visit limit — a guest may be signed in at most 3 times in any
--     rolling 12 months. After that they have to join as a member.
--
--   * £2 fee — paid by the signing member, per guest, by cash or card.
--     Never a tab: guests can't run tabs and the fee isn't put on the
--     member's either. The fee is an itemless order flagged is_guest_fee
--     (like tab settlements), so it lands in takings and the Z report.
--
-- sign_in_guests does all of it in one transaction: if any guest in the
-- party is over the limit, nobody is signed in and nothing is charged.
--
-- Keep GUEST_FEE / GUEST_VISIT_LIMIT in src/lib/guests.js in sync.

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  date_of_birth date not null,
  created_at timestamptz not null default now(),
  unique (name_key, date_of_birth)
);

alter table guests enable row level security;

drop policy if exists "Till device full access" on guests;
create policy "Till device full access" on guests
  for all to authenticated
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- Sign-ins made before this migration have no guest record and don't
-- count towards anyone's limit.
alter table guest_signins add column if not exists guest_id uuid references guests(id);
alter table guest_signins add column if not exists order_id uuid references orders(id);
alter table guest_signins add column if not exists fee numeric(10,2) not null default 0;

create index if not exists guest_signins_guest_id_idx on guest_signins (guest_id, created_at);

alter table orders add column if not exists is_guest_fee boolean not null default false;

-- p_guests: [{ "name": "Jane Doe", "date_of_birth": "1990-05-01" }, ...]
-- Returns the fee order id.
create or replace function sign_in_guests(
  p_member_id uuid,
  p_guests jsonb,
  p_payment_method text,
  p_staff_id uuid,
  p_till_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_fee constant numeric := 2.00;
  c_visit_limit constant int := 3;
  v_member members%rowtype;
  v_count int;
  v_order_id uuid;
  v_guest jsonb;
  v_name text;
  v_dob date;
  v_guest_id uuid;
  v_visits int;
  v_today date;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  if p_payment_method not in ('cash', 'card') then
    raise exception 'the guest fee is paid by cash or card — no tabs';
  end if;

  select * into v_member from members where id = p_member_id;
  if not found or not coalesce(v_member.active, false) then
    raise exception 'select an active member to sign guests in';
  end if;

  v_count := coalesce(jsonb_array_length(p_guests), 0);
  if v_count = 0 then
    raise exception 'enter at least one guest';
  end if;

  insert into orders (member_id, till_id, payment_method, total_amount, status, is_guest_fee)
  values (p_member_id, coalesce(p_till_id, 'till-1'), p_payment_method, c_fee * v_count, 'paid', true)
  returning id into v_order_id;

  -- Trading day: 06:00–06:00 UTC, matching src/lib/tradingDay.js
  v_today := ((now() at time zone 'UTC') - interval '6 hours')::date;

  for v_guest in select * from jsonb_array_elements(p_guests) loop
    v_name := regexp_replace(btrim(coalesce(v_guest->>'name', '')), '\s+', ' ', 'g');
    v_dob := nullif(v_guest->>'date_of_birth', '')::date;

    if v_name = '' then
      raise exception 'every guest needs a name';
    end if;
    if v_dob is null then
      raise exception 'enter a date of birth for %', v_name;
    end if;
    if v_dob > current_date then
      raise exception 'date of birth for % is in the future', v_name;
    end if;

    -- Upsert the guest record; the DO UPDATE locks the row so two tills
    -- can't both sign in someone on their last visit.
    insert into guests (name, date_of_birth)
    values (v_name, v_dob)
    on conflict (name_key, date_of_birth) do update set name = guests.name
    returning id into v_guest_id;

    if exists (
      select 1 from guest_signins
      where guest_id = v_guest_id
        and ((created_at at time zone 'UTC') - interval '6 hours')::date = v_today
    ) then
      raise exception '% is already signed in tonight', v_name;
    end if;

    select count(*) into v_visits
      from guest_signins
      where guest_id = v_guest_id
        and created_at > now() - interval '12 months';

    if v_visits >= c_visit_limit then
      raise exception '% has already visited % times in the last 12 months — they need to join as a member',
        v_name, c_visit_limit;
    end if;

    insert into guest_signins (guest_name, guest_id, member_id, staff_id, till_id, order_id, fee)
    values (v_name, v_guest_id, p_member_id, p_staff_id, coalesce(p_till_id, 'till-1'), v_order_id, c_fee);
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function sign_in_guests(uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function sign_in_guests(uuid, jsonb, text, uuid, text) to authenticated;
