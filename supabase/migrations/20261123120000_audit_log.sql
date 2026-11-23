-- Fort Knox: a tamper-evident audit log of everything.
--
-- Background: a price was changed by an unknown person and nothing recorded
-- who, when, or what it used to be. 20261122120000 fixed that one case
-- (price change log, staff on orders). This migration closes the general
-- problem: EVERY change to EVERY table, every staff sign-in and PIN attempt,
-- and every sensitive action at the till that writes no row (a line removed
-- from an order, the drawer opened without a sale, a report exported) is
-- recorded with when, which till device, which staff member, from which
-- network address — and the record itself cannot be edited or deleted from
-- a till, and is hash-sealed so tampering by anyone else is detectable.
--
-- Design rules (do not weaken these when editing):
--
--   1. LOGGING MUST NEVER STOP A SALE. Every capture path is wrapped in an
--      exception block that swallows its own failure into auditlog.failures.
--      Nothing here takes a lock a sale can wait on, adds a foreign key to a
--      business table, or changes a business table's shape.
--   2. NOTHING SECRET IS COPIED. members.pin_hash is redacted before any row
--      image is stored; staff session tokens are stored only as sha256.
--   3. THE LOG IS OUT OF REACH. It lives in schema "auditlog", which PostgREST
--      does not expose: no till, member, anon or even service-role API call
--      can read or write it directly. The only doors are the SECURITY
--      DEFINER functions at the bottom of this file.
--   4. IDENTITY IS DECIDED BY THE SERVER. The till device comes from the
--      authenticated JWT (never the client's till_id claim). The staff
--      member comes from a server-side session created by checking the PIN
--      here, in the database (staff_sign_in) — the till then presents that
--      session's token in an x-staff-session header and every trigger
--      resolves the person from it. Anything weaker is labelled as such
--      (staff_trust: pin | claimed | session_record | none).
--   5. OLD BUNDLES KEEP WORKING. Nothing a currently deployed till does is
--      refused. The only operations refused are ones no till code has ever
--      performed (deleting or editing ledger rows directly), and even those
--      are recorded and can be switched to observe-only in auditlog.settings.
--
-- Contents:
--    1. schema, settings, failure sink
--    2. origins, staff sessions
--    3. the log + append-only enforcement + row hashing
--    4. request context (who / which till / which staff member / from where)
--    5. row capture trigger for every table
--    6. ledger guards (history cannot be rewritten from a till)
--    7. staff sign-in, PIN checks and PIN changes in the database
--    8. client event intake
--    9. sealing (hash chain) + verification + nightly self-check
--   10. read API for the in-app viewer
--   11. personal-data erasure (owner only, from SQL)
--   12. attach to every table, schedule jobs, record installation

-- ── 1. Schema, settings, failure sink ────────────────────────────────────

-- Named "auditlog", not "audit": Supabase's optional supa_audit extension
-- owns a schema called "audit", and this file revokes privileges schema-wide.

create schema if not exists auditlog;
revoke all on schema auditlog from public, anon, authenticated, service_role;

-- bcrypt for PIN checks. Supabase ships pgcrypto in schema "extensions";
-- guarded so an unusual setup cannot fail the migration (staff_sign_in
-- would then raise at run time and the till falls back to verify-pin).
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice 'pgcrypto not created here: %', sqlerrm;
end $$;

create table if not exists auditlog.settings (
  id boolean primary key default true check (id),
  -- Master switch for row capture. Turn OFF only if capture itself is
  -- misbehaving: update auditlog.settings set capture_enabled = false;
  capture_enabled boolean not null default true,
  -- When true, forbidden direct writes to ledgers are refused (and logged).
  -- When false they are only logged ("would_block").
  guards_enforced boolean not null default true,
  -- A staff session older than this is ignored and the till must re-PIN.
  session_max_hours int not null default 24 check (session_max_hours between 1 and 168)
);
insert into auditlog.settings default values on conflict (id) do nothing;

-- Where capture failures land. Should stay empty; the viewer's health strip
-- shows the count. No hashing, no guards: it must be the simplest possible
-- insert, because it runs when something else has already gone wrong.
create table if not exists auditlog.failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  source text not null,
  error text not null,
  table_name text,
  op text
);

-- ── 2. Origins and staff sessions ────────────────────────────────────────

-- One row per distinct (network address, browser, app build) seen, so the
-- log stores a small id instead of repeating a 150-byte user agent on every
-- entry.
create table if not exists auditlog.origins (
  id bigint generated always as identity primary key,
  fingerprint text not null unique,
  ip text,
  user_agent text,
  app_build text,
  first_seen timestamptz not null default now()
);

-- First time each till device is seen from each network address. A till
-- suddenly talking from a new address is worth a look (credentials used
-- elsewhere), so the first sighting raises an alert.
create table if not exists auditlog.device_ips (
  device uuid not null,
  ip text not null,
  first_seen timestamptz not null default now(),
  primary key (device, ip)
);

-- A staff member signed in at a till. Created only by the functions in
-- section 7. The raw token is returned to the till once and never stored.
create table if not exists auditlog.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  device uuid not null,
  till_id text,
  token_hash bytea not null unique,
  -- 'pin'     = this database checked the PIN itself
  -- 'claimed' = the till says the legacy verify-pin function accepted it
  trust text not null check (trust in ('pin', 'claimed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  origin_id bigint
);
create index if not exists staff_sessions_device_idx on auditlog.staff_sessions (device, started_at desc);
create index if not exists staff_sessions_staff_idx on auditlog.staff_sessions (staff_id, started_at desc);

-- ── 3. The log ───────────────────────────────────────────────────────────

create table if not exists auditlog.log (
  seq bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  -- row    = a table row was inserted / updated / deleted
  -- event  = something happened at the till that writes no row
  -- auth   = staff sign-in / sign-out / PIN attempt
  -- guard  = a forbidden write was refused (or would have been)
  -- system = the log's own housekeeping and self-checks
  kind text not null check (kind in ('row', 'event', 'auth', 'guard', 'system')),
  action text not null,
  -- 0 routine · 1 notable · 2 needs a look · 3 serious
  severity smallint not null default 0 check (severity between 0 and 3),
  table_name text,
  row_pk text,
  old_data jsonb,
  new_data jsonb,
  changed text[],
  detail jsonb,
  -- till | member | service (edge function / service key) | database
  -- (dashboard, SQL, migration, cron) | anon
  actor text not null,
  auth_uid uuid,
  till_id text,
  staff_id uuid,
  staff_trust text not null default 'none',
  staff_session_id uuid,
  origin_id bigint,
  via text,
  -- For client events and offline replays: when the till says it happened.
  client_at timestamptz,
  client_event_id uuid,
  txid bigint not null default txid_current(),
  row_hash bytea not null,
  seal_id bigint,
  erased_at timestamptz
);

-- Sized for years of trading on a small database: time is BRIN (the log is
-- written in time order, so a few kilobytes index millions of rows), and
-- the per-record index leaves out the two tables that make up most rows.
create index if not exists log_at_idx on auditlog.log using brin (at);
create index if not exists log_record_idx on auditlog.log (table_name, row_pk, seq desc)
  where table_name is not null and table_name not in ('order_items', 'stock_movements');
create index if not exists log_staff_idx on auditlog.log (staff_id, seq desc) where staff_id is not null;
create index if not exists log_alert_idx on auditlog.log (seq desc) where severity >= 2;
create index if not exists log_unsealed_idx on auditlog.log (seq) where seal_id is null;
-- For verification (rows of one seal, in order). Partial, so it is only
-- ever written when a row is sealed (by cron), never during a sale.
create index if not exists log_seal_idx on auditlog.log (seal_id, seq) where seal_id is not null;
create unique index if not exists log_client_event_idx on auditlog.log (client_event_id) where client_event_id is not null;

-- "Checked" marks on alerts. Insert-only: an acknowledgement is itself a
-- record of who looked and when.
create table if not exists auditlog.acks (
  seq bigint primary key,
  staff_id uuid,
  note text,
  at timestamptz not null default now()
);

create table if not exists auditlog.seals (
  id bigint generated always as identity primary key,
  sealed_at timestamptz not null default clock_timestamp(),
  first_seq bigint not null,
  last_seq bigint not null,
  row_count int not null,
  rows_hash bytea not null,
  prev_hash bytea,
  hash bytea not null
);

-- The canonical digest of a log row. Used at insert and again at
-- verification, so it must depend ONLY on the row's stored content: every
-- timestamp is rendered in UTC explicitly (jsonb's own timestamptz output
-- follows the session's TimeZone and would make the same row hash
-- differently from two sessions).
create or replace function auditlog.row_digest(l auditlog.log)
returns bytea
language sql
immutable
set search_path = auditlog, public
as $$
  select sha256(convert_to(jsonb_build_array(
    l.seq,
    to_char(l.at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    l.kind, l.action, l.severity, l.table_name, l.row_pk,
    l.old_data, l.new_data, to_jsonb(l.changed), l.detail,
    l.actor, l.auth_uid, l.till_id, l.staff_id, l.staff_trust, l.staff_session_id,
    l.origin_id, l.via,
    case when l.client_at is null then null
         else to_char(l.client_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US') end,
    l.client_event_id, l.txid
  )::text, 'utf8'))
$$;

create or replace function auditlog.log_before_insert()
returns trigger
language plpgsql
set search_path = auditlog, public
as $$
begin
  -- Server-owned fields: whatever the caller passed is overwritten.
  new.at := clock_timestamp();
  new.txid := txid_current();
  new.seal_id := null;
  new.erased_at := null;
  new.row_hash := auditlog.row_digest(new);
  return new;
end;
$$;

drop trigger if exists log_before_insert on auditlog.log;
create trigger log_before_insert
  before insert on auditlog.log
  for each row execute function auditlog.log_before_insert();

-- Append-only enforcement for the audit tables themselves. Applies to EVERY
-- role, including the service key and the SQL editor: the only way round it
-- is to disable the trigger, which the nightly self-check reports.
--
-- Three narrow updates are allowed, each only from inside the one function
-- that needs it (flagged by a transaction-local setting) and each checked
-- here field by field, so the flag alone opens nothing else:
--   log:            seal_id null -> set, nothing else touched (sealing)
--   log:            a member row's personal fields blanked, nothing else
--                   touched, hashes untouched (erasure)
--   staff_sessions: ended_at / end_reason set once (sign-out)
-- Blanks the personal fields of a member row image. The ONLY change the
-- erasure path is allowed to make to a log entry (see append_only).
create or replace function auditlog.erase_pii(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select case when p_row is null or jsonb_typeof(p_row) <> 'object' then p_row else (
    select jsonb_object_agg(e.key,
             case when e.key in ('name', 'phone', 'email', 'notes', 'favourite_drinks')
                  then '"[erased]"'::jsonb else e.value end)
      from jsonb_each(p_row) e) end
$$;

-- What an entry SAYS (as opposed to who/when/where): hashed again after an
-- erasure so the blanked entry can still be checked.
create or replace function auditlog.content_digest(l auditlog.log)
returns bytea
language sql
immutable
set search_path = auditlog, public
as $$
  select sha256(convert_to(jsonb_build_array(l.old_data, l.new_data, l.detail)::text, 'utf8'))
$$;

create or replace function auditlog.append_only()
returns trigger
language plpgsql
set search_path = auditlog, public
as $$
begin
  if TG_OP = 'UPDATE' then
    if TG_TABLE_NAME = 'log' then
      if current_setting('auditlog.sealing', true) = 'on'
         and old.seal_id is null and new.seal_id is not null
         and (to_jsonb(new) - 'seal_id') = (to_jsonb(old) - 'seal_id') then
        return new;
      end if;
      -- Erasure is not a general "edit" door: the trigger itself checks
      -- that the row is a member row image and that the new content is
      -- EXACTLY the old content with the personal fields blanked. Setting
      -- the flag by hand cannot be used to rewrite what an entry says.
      if current_setting('auditlog.erasing', true) = 'on'
         and old.table_name = 'members' and old.kind in ('row', 'guard')
         and new.erased_at is not null
         and (to_jsonb(new) - array['old_data', 'new_data', 'erased_at'])
           = (to_jsonb(old) - array['old_data', 'new_data', 'erased_at'])
         and new.old_data is not distinct from auditlog.erase_pii(old.old_data)
         and new.new_data is not distinct from auditlog.erase_pii(old.new_data) then
        return new;
      end if;
    elsif TG_TABLE_NAME = 'staff_sessions' then
      if old.ended_at is null and new.ended_at is not null
         and (to_jsonb(new) - array['ended_at', 'end_reason'])
           = (to_jsonb(old) - array['ended_at', 'end_reason']) then
        return new;
      end if;
    end if;
  end if;
  raise exception 'auditlog.% is append-only (% refused)', TG_TABLE_NAME, TG_OP
    using errcode = 'insufficient_privilege';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['log', 'seals', 'acks', 'origins', 'device_ips', 'staff_sessions'] loop
    execute format('drop trigger if exists append_only on auditlog.%I', t);
    execute format('create trigger append_only before update or delete on auditlog.%I
                    for each row execute function auditlog.append_only()', t);
    execute format('drop trigger if exists append_only_truncate on auditlog.%I', t);
    execute format('create trigger append_only_truncate before truncate on auditlog.%I
                    for each statement execute function auditlog.append_only()', t);
  end loop;
end $$;

-- ── 4. Request context ───────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'auditlog' and t.typname = 'context') then
    create type auditlog.context as (
      actor text,
      auth_uid uuid,
      till_id text,
      staff_id uuid,
      staff_trust text,
      staff_session_id uuid,
      origin_id bigint,
      via text
    );
  end if;
end $$;

-- Who is making this request? Everything is derived from what the SERVER
-- knows: the JWT PostgREST verified, the headers it received, and our own
-- session table. Computed once per transaction and cached in a
-- transaction-local setting (PostgREST runs each request in one
-- transaction), so a 12-line sale does not repeat the lookups 30 times.
--
-- Never raises: every lookup that could fail has its own handler and falls
-- back to "unknown", because this runs inside triggers on the sale path.
create or replace function auditlog.ctx()
returns auditlog.context
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context;
  cached text;
  h json;
  claims json;
  jwt_role text;
  token text;
  s record;
  v_ip text;
  v_ua text;
  v_build text;
  v_fp text;
  v_new_ip boolean := false;
begin
  cached := current_setting('auditlog.ctx_cache', true);
  if cached is not null and cached <> '' then
    begin
      return jsonb_populate_record(null::auditlog.context, cached::jsonb);
    exception when others then
      null; -- unreadable cache: recompute
    end;
  end if;

  c.staff_trust := 'none';

  begin h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null; end;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::json;
  exception when others then claims := null; end;
  jwt_role := coalesce(claims ->> 'role', nullif(current_setting('request.jwt.claim.role', true), ''));
  begin c.auth_uid := auth.uid();
  exception when others then c.auth_uid := null; end;

  if h is null and jwt_role is null then
    -- Not an API request at all: the dashboard SQL editor, a migration, a
    -- cron job, psql. There is no person we can name.
    c.actor := 'database';
    c.via := coalesce(
      nullif(current_setting('auditlog.via', true), ''),
      'sql:' || session_user || coalesce('/' || nullif(current_setting('application_name', true), ''), ''));
  else
    c.via := nullif(trim(coalesce(current_setting('request.method', true), '') || ' '
                      || coalesce(current_setting('request.path', true), '')), '');
    if jwt_role = 'service_role' then
      c.actor := 'service';
      -- Edge functions may name themselves (see supabase/functions/*).
      if h ->> 'x-audit-actor' is not null then
        c.via := left('fn:' || (h ->> 'x-audit-actor') || ' ' || coalesce(c.via, ''), 200);
      end if;
    elsif jwt_role = 'authenticated' then
      begin
        select d.till_id into c.till_id from public.till_devices d where d.auth_user_id = c.auth_uid;
      exception when others then c.till_id := null; end;
      c.actor := case when c.till_id is not null then 'till' else 'member' end;
    else
      c.actor := 'anon';
    end if;

    -- Where from. cf-connecting-ip is set by the edge network and cannot be
    -- supplied by the caller; x-forwarded-for's first hop can, so it is the
    -- last resort.
    begin
      v_ip := nullif(trim(coalesce(
        h ->> 'cf-connecting-ip',
        h ->> 'x-real-ip',
        split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1))), '');
      v_ua := left(h ->> 'user-agent', 300);
      v_build := left(h ->> 'x-app-build', 40);
      if v_ip is not null or v_ua is not null or v_build is not null then
        v_fp := md5(concat_ws('|', coalesce(v_ip, ''), coalesce(v_ua, ''), coalesce(v_build, '')));
        select o.id into c.origin_id from auditlog.origins o where o.fingerprint = v_fp;
        -- First sighting. Two requests seeing the same new origin at once
        -- (both tills, straight after a new build goes out) would make the
        -- second wait for the first's whole transaction on the unique
        -- index. The try-lock means only one of them writes it; the other
        -- carries on with no origin on this one entry.
        if c.origin_id is null and pg_try_advisory_xact_lock(7203, hashtext(v_fp)) then
          insert into auditlog.origins (fingerprint, ip, user_agent, app_build)
          values (v_fp, v_ip, v_ua, v_build)
          on conflict (fingerprint) do nothing;
          select o.id into c.origin_id from auditlog.origins o where o.fingerprint = v_fp;
        end if;
      end if;
      if c.actor = 'till' and v_ip is not null
         and not exists (select 1 from auditlog.device_ips d where d.device = c.auth_uid and d.ip = v_ip)
         and pg_try_advisory_xact_lock(7204, hashtext(c.auth_uid::text || v_ip)) then
        insert into auditlog.device_ips (device, ip) values (c.auth_uid, v_ip)
        on conflict (device, ip) do nothing;
        v_new_ip := found;
      end if;
    exception when others then
      c.origin_id := null;
    end;

    -- Which staff member. Only a till can carry a staff session, and only
    -- the device the session was created on.
    if c.actor = 'till' then
      begin
        token := nullif(h ->> 'x-staff-session', '');
        if token is not null then
          select ss.id, ss.staff_id, ss.trust into s
            from auditlog.staff_sessions ss
           where ss.token_hash = sha256(convert_to(token, 'utf8'))
             and ss.device = c.auth_uid
             and ss.ended_at is null
             and ss.started_at > now() - make_interval(hours => (select session_max_hours from auditlog.settings));
          if found then
            c.staff_id := s.staff_id;
            c.staff_trust := s.trust;
            c.staff_session_id := s.id;
          end if;
        end if;
      exception when others then
        c.staff_id := null; c.staff_trust := 'none'; c.staff_session_id := null;
      end;
    end if;
  end if;

  perform set_config('auditlog.ctx_cache', to_jsonb(c)::text, true);

  if v_new_ip then
    begin
      perform auditlog.write(c, 'system', 'device.new_address', 2, null, null, null, null, null,
        jsonb_build_object('ip', v_ip, 'user_agent', v_ua, 'app_build', v_build,
          'note', 'This till device was seen from a network address it has not used before.'));
    exception when others then null;
    end;
  end if;

  return c;
end;
$$;

-- The single place rows enter the log.
create or replace function auditlog.write(
  p_ctx auditlog.context,
  p_kind text,
  p_action text,
  p_severity int default 0,
  p_table text default null,
  p_pk text default null,
  p_old jsonb default null,
  p_new jsonb default null,
  p_changed text[] default null,
  p_detail jsonb default null,
  p_client_at timestamptz default null,
  p_client_event_id uuid default null
)
returns bigint
language sql
security definer
set search_path = auditlog, public
as $$
  insert into auditlog.log (
    kind, action, severity, table_name, row_pk, old_data, new_data, changed, detail,
    actor, auth_uid, till_id, staff_id, staff_trust, staff_session_id, origin_id, via,
    client_at, client_event_id, row_hash)
  values (
    p_kind, left(p_action, 120), greatest(0, least(3, coalesce(p_severity, 0))),
    p_table, p_pk, p_old, p_new, p_changed, p_detail,
    coalesce((p_ctx).actor, 'database'), (p_ctx).auth_uid, (p_ctx).till_id,
    (p_ctx).staff_id, coalesce((p_ctx).staff_trust, 'none'), (p_ctx).staff_session_id,
    (p_ctx).origin_id, left((p_ctx).via, 200),
    p_client_at, p_client_event_id, '\x'::bytea)
  on conflict (client_event_id) where client_event_id is not null do nothing
  returning seq
$$;

-- The same, for callers that have no handler of their own: a log write that
-- fails is recorded in auditlog.failures and the caller carries on. Sign-in,
-- the viewer and the nightly job all use this — a broken log must never
-- lock staff out of the till.
create or replace function auditlog.try_write(
  p_ctx auditlog.context,
  p_kind text,
  p_action text,
  p_severity int default 0,
  p_table text default null,
  p_pk text default null,
  p_old jsonb default null,
  p_new jsonb default null,
  p_changed text[] default null,
  p_detail jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = auditlog, public
as $$
begin
  return auditlog.write(p_ctx, p_kind, p_action, p_severity, p_table, p_pk, p_old, p_new, p_changed, p_detail);
exception when others then
  begin
    insert into auditlog.failures (source, error, table_name, op)
    values ('write:' || coalesce(p_action, '?'), sqlerrm, p_table, p_kind);
  exception when others then
    raise warning 'audit: write of % failed and could not be recorded: %', p_action, sqlerrm;
  end;
  return null;
end;
$$;

-- Removes what must never be stored from a row image.
create or replace function auditlog.scrub(p_table text, p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_row is null then null
    when p_table = 'members' and p_row ? 'pin_hash' then
      jsonb_set(p_row, '{pin_hash}',
        case when p_row -> 'pin_hash' = 'null'::jsonb then 'null'::jsonb else '"[redacted]"'::jsonb end)
    -- changed_by is a write-only pass-through (see 20261122120000), never state.
    when p_table = 'products' then p_row - 'changed_by'
    else p_row
  end
$$;

-- Is this request a call to one of the app's own database functions?
-- Those are trusted code: they may update ledgers. Everything else from an
-- API caller is "direct" access — a plain table write, and also Supabase's
-- GraphQL endpoint, which reaches PostgREST as /rpc/graphql and would
-- otherwise look like a function call while performing arbitrary table
-- writes. Looked up in pg_proc rather than listed by hand so a function
-- added later cannot be forgotten (which would make the guards refuse its
-- legitimate work).
create or replace function auditlog.via_is_app_function(p_via text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = substring(p_via from '^[A-Z]+ \S*/rpc/([A-Za-z0-9_]+)$'))
$$;

-- ── 5. Row capture ───────────────────────────────────────────────────────

-- One generic AFTER trigger on every table. INSERT stores the new row,
-- DELETE the old row, UPDATE only the columns that changed (old and new
-- values) — so the log holds what is needed to reconstruct history without
-- storing every wide row twice.
--
-- TG_ARGV[0] is the primary-key column (default 'id').
create or replace function auditlog.capture_row()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context;
  o jsonb;
  n jsonb;
  ch text[];
  pk text;
  pkcol text := coalesce(TG_ARGV[0], 'id');
  sev int := 0;
  det jsonb := '{}'::jsonb;
  flags text[] := '{}';
  direct boolean;
  v_late numeric;
  v_islate boolean := false;
  v_rung text;
  v_trust text;
begin
  begin
    if not coalesce((select capture_enabled from auditlog.settings), true) then
      return null;
    end if;

    if TG_OP <> 'INSERT' then o := to_jsonb(OLD); end if;
    if TG_OP <> 'DELETE' then n := to_jsonb(NEW); end if;
    pk := coalesce(n, o) ->> pkcol;

    if TG_OP = 'UPDATE' then
      select array_agg(e.key order by e.key) into ch
        from jsonb_each(n) e
       where e.value is distinct from o -> e.key
         and not (TG_TABLE_NAME = 'products' and e.key = 'changed_by');
      if ch is null then
        return null; -- nothing actually changed
      end if;
      -- The stock trigger decrements products.stock_quantity on every sale
      -- line; that is derived state already recorded as a stock movement.
      -- A stock figure typed into the product form (depth 1) IS logged.
      if TG_TABLE_NAME = 'products' and ch = array['stock_quantity'] and pg_trigger_depth() > 1 then
        return null;
      end if;
    end if;

    -- The price change log row is written by a trigger from the products
    -- update that is itself logged with the same values.
    if TG_TABLE_NAME = 'product_price_changes' and TG_OP = 'INSERT' and pg_trigger_depth() > 1 then
      return null;
    end if;

    c := auditlog.ctx();
    direct := c.via is not null and c.actor in ('till', 'member', 'anon')
              and not auditlog.via_is_app_function(c.via);

    -- ── What makes this entry notable ──
    begin
      if c.actor = 'database' then
        sev := 2; flags := array_append(flags, 'outside_the_till');
      elsif c.actor = 'service' then
        sev := 1;
      elsif c.actor in ('member', 'anon') then
        sev := 2; flags := array_append(flags, 'unexpected_actor');
      end if;

      if TG_OP = 'DELETE' and TG_TABLE_NAME not in ('promotion_items', 'promotion_categories', 'pin_attempts') then
        sev := greatest(sev, 2);
      end if;

      if TG_TABLE_NAME = 'products' then
        if TG_OP = 'INSERT' then
          sev := greatest(sev, 1);
        elsif TG_OP = 'UPDATE' then
          if ch && array['standard_price', 'member_price'] then
            sev := greatest(sev, 1); flags := array_append(flags, 'price_changed');
            -- The exact shape of the incident that started this: a product
            -- that had a member discount no longer has one.
            if (o ->> 'standard_price')::numeric > (o ->> 'member_price')::numeric
               and (n ->> 'standard_price')::numeric <= (n ->> 'member_price')::numeric then
              sev := greatest(sev, 2); flags := array_append(flags, 'member_discount_removed');
            end if;
          end if;
          if ch && array['active'] then sev := greatest(sev, 1); end if;
          if ch && array['stock_quantity'] then flags := array_append(flags, 'stock_typed_in'); end if;
        end if;

      elsif TG_TABLE_NAME = 'orders' then
        if TG_OP = 'INSERT' then
          v_late := extract(epoch from (clock_timestamp() - (n ->> 'created_at')::timestamptz));
          v_islate := abs(v_late) > 120;
          if v_islate then
            flags := array_append(flags, 'arrived_late');
            det := det || jsonb_build_object('late_by_seconds', round(v_late));
          end if;
          if c.till_id is not null and n ->> 'till_id' is distinct from c.till_id then
            flags := array_append(flags, 'till_claim_mismatch');
          end if;
          if v_islate then sev := greatest(sev, 1); end if;
          -- The app creates sales through create_order_with_items only.
          if direct then
            sev := greatest(sev, 2); flags := array_append(flags, 'direct_insert_of_sale');
          end if;

          -- Who rang it, and how sure are we? The order row carries the
          -- staff id the till claimed, and THAT is who this entry is about —
          -- not whoever happens to be signed in on the request that sent it
          -- (an offline sale is sent later, often under someone else).
          --   pin             the claim matches the PIN session on this request
          --   session_record  a session for that person on this device
          --                   covered the sale time (a replayed offline sale)
          --   claimed         nothing here backs the claim
          v_rung := n ->> 'staff_id';
          if v_rung is null then
            flags := array_append(flags, 'no_staff_on_sale');
            if c.staff_id is not null then
              det := det || jsonb_build_object('sent_by', c.staff_id, 'sent_by_trust', c.staff_trust);
              if v_islate then
                -- A queued sale from before staff were recorded: do not
                -- headline whoever sent it as the person who rang it.
                c.staff_id := null; c.staff_trust := 'none'; c.staff_session_id := null;
              end if;
            end if;
          elsif c.staff_id is not null and v_rung = c.staff_id::text then
            det := det || jsonb_build_object('rung_by_trust', c.staff_trust);
          else
            if c.staff_id is not null then
              det := det || jsonb_build_object('sent_by', c.staff_id, 'sent_by_trust', c.staff_trust);
            end if;
            if c.staff_id is not null and not v_islate then
              -- Live, and the till names someone other than the person
              -- whose PIN session sent it.
              v_trust := 'claimed';
              sev := greatest(sev, 2);
              flags := array_append(flags, 'staff_mismatch');
            elsif exists (
              select 1 from auditlog.staff_sessions ss
               where ss.staff_id::text = v_rung and ss.device = c.auth_uid
                 and ss.started_at <= (n ->> 'created_at')::timestamptz + interval '1 minute'
                 and coalesce(ss.ended_at, now()) >= (n ->> 'created_at')::timestamptz - interval '1 minute') then
              v_trust := 'session_record';
            else
              v_trust := 'claimed';
              flags := array_append(flags, 'staff_unverified');
            end if;
            det := det || jsonb_build_object('rung_by_trust', v_trust);
            c.staff_id := v_rung::uuid; c.staff_trust := v_trust; c.staff_session_id := null;
          end if;
        elsif TG_OP = 'UPDATE' then
          if n ->> 'status' = 'voided' and ch && array['status'] then
            sev := greatest(sev, 1); flags := array_append(flags, 'voided');
          end if;
          -- A till editing an order row directly may only void it. Anything
          -- else (amount, method, date, member) goes through an RPC.
          if direct and not (ch <@ array['status'] and n ->> 'status' = 'voided') then
            sev := 3; flags := array_append(flags, 'direct_edit_of_sale');
          end if;
        end if;

      elsif TG_TABLE_NAME = 'members' and TG_OP = 'INSERT' then
        if n ->> 'membership_tier' = 'staff' then
          sev := greatest(sev, 2); flags := array_append(flags, 'staff_created');
        end if;

      elsif TG_TABLE_NAME = 'members' and TG_OP = 'UPDATE' then
        if ch && array['membership_tier'] then
          sev := greatest(sev, 2); flags := array_append(flags, 'tier_changed');
        end if;
        if ch && array['pin_hash'] then
          sev := greatest(sev, 1); flags := array_append(flags, 'pin_changed');
        end if;
        if ch && array['email', 'auth_user_id', 'active'] then sev := greatest(sev, 1); end if;
        -- A balance moved by the bare adjustment function (a tab adjustment or
        -- a drink taken off a tab) rather than by a sale or a payment.
        if ch && array['tab_balance'] and coalesce(c.via, '') like '%/rpc/adjust_tab_balance' then
          sev := greatest(sev, 1); flags := array_append(flags, 'tab_balance_adjusted');
        end if;
        -- Balances, PINs and login links are managed by functions. A till
        -- writing them straight into the row is not something the app does.
        if direct and ch && array['tab_balance', 'pin_hash', 'auth_user_id', 'last_settled_at'] then
          sev := 3; flags := array_append(flags, 'direct_edit_of_protected_field');
        end if;

      elsif TG_TABLE_NAME = 'till_devices' then
        sev := 3; flags := array_append(flags, 'till_registration_changed');
      elsif TG_TABLE_NAME in ('z_report_recipients', 'monthly_report_recipients') then
        sev := greatest(sev, 2); flags := array_append(flags, 'report_recipients_changed');
      elsif TG_TABLE_NAME in ('tab_adjustments', 'order_corrections', 'cashback_transactions', 'prize_wins')
            and TG_OP = 'INSERT' then
        sev := greatest(sev, 1);
      end if;
    exception when others then
      det := det || jsonb_build_object('enrich_error', sqlerrm);
    end;

    if TG_OP = 'UPDATE' then
      -- Keep only what changed (after the checks above, which needed the
      -- full images).
      select jsonb_object_agg(e.key, e.value) into o from jsonb_each(o) e where e.key = any (ch);
      select jsonb_object_agg(e.key, e.value) into n from jsonb_each(n) e where e.key = any (ch);
    end if;
    o := auditlog.scrub(TG_TABLE_NAME, o);
    n := auditlog.scrub(TG_TABLE_NAME, n);
    if array_length(flags, 1) > 0 then
      det := det || jsonb_build_object('flags', to_jsonb(flags));
    end if;

    perform auditlog.write(c, 'row', lower(TG_OP), sev, TG_TABLE_NAME, pk, o, n, ch, nullif(det, '{}'::jsonb));
  exception when others then
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('capture_row', sqlerrm, TG_TABLE_NAME, TG_OP);
    exception when others then
      raise warning 'audit: capture failed on %.% and could not be recorded: %', TG_TABLE_NAME, TG_OP, sqlerrm;
    end;
  end;
  return null;
end;
$$;

-- INSERTs into the two high-volume ledgers are captured once per STATEMENT
-- instead of once per row: a four-drink round is one entry holding its four
-- lines, not four entries. (Per-row capture of a sale cost ~7.7 KB with
-- indexes; this is about a quarter of that, with nothing left out.)
-- UPDATE and DELETE on these tables stay per-row (and are guarded).
--
--   order_items     new_data = [line, ...] (order_id / created_at factored
--                   out), row_pk = the order id, detail.lines[<line id>] =
--                   the product's name and LIST prices at that moment, so
--                   "was this sold at the wrong price?" still has an answer
--                   after the product is edited again.
--   stock_movements new_data = [movement, ...]. The 'sale' movements the
--                   order function derives from the lines it has just
--                   inserted are left out: they repeat the lines exactly.
create or replace function auditlog.capture_insert_bulk()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context;
  v_rows jsonb;
  v_n int;
  v_pk text;
  v_orders int;
  sev int := 0;
  det jsonb := '{}'::jsonb;
  flags text[] := '{}';
  v_lines jsonb;
  v_below boolean;
  v_parent record;
begin
  begin
    if not coalesce((select capture_enabled from auditlog.settings), true) then
      return null;
    end if;
    c := auditlog.ctx();

    if c.actor = 'database' then
      sev := 2; flags := array_append(flags, 'outside_the_till');
    elsif c.actor = 'service' then
      sev := 1;
    elsif c.actor in ('member', 'anon') then
      sev := 2; flags := array_append(flags, 'unexpected_actor');
    end if;

    if TG_TABLE_NAME = 'order_items' then
      select count(*), min(j ->> 'order_id'), count(distinct j ->> 'order_id'),
             -- created_at is normally just "now" and is left out; a line
             -- whose date is anything else (back-dated by hand) keeps it.
             jsonb_agg(j - 'order_id' - case when abs(extract(epoch from (now() - (j ->> 'created_at')::timestamptz))) < 5
                                              then 'created_at' else '' end)
        into v_n, v_pk, v_orders, v_rows
        from (select to_jsonb(r) as j from new_rows r) x;
      if coalesce(v_n, 0) = 0 then return null; end if;
      if v_orders > 1 then
        -- Never done by the app; keep the order ids rather than lose them.
        select jsonb_agg(to_jsonb(r) - 'created_at') into v_rows from new_rows r;
        v_pk := null;
      end if;
      begin
        select jsonb_object_agg(j ->> 'id', jsonb_strip_nulls(jsonb_build_object(
                 'product', p.name, 'list_standard', p.standard_price, 'list_member', p.member_price,
                 'below_list_price', case when (j ->> 'unit_price')::numeric < least(p.standard_price, p.member_price) then true end))),
               bool_or((j ->> 'unit_price')::numeric < least(p.standard_price, p.member_price))
          into v_lines, v_below
          from (select to_jsonb(r) as j from new_rows r) x
          left join public.products p on p.id::text = x.j ->> 'product_id';
        det := det || jsonb_build_object('lines', v_lines);
        if v_below then flags := array_append(flags, 'below_list_price'); end if;
      exception when others then
        det := det || jsonb_build_object('enrich_error', sqlerrm);
      end;
      -- The lines are about whoever the sale is about: take the attribution
      -- the order's own entry was given in this same transaction (an
      -- offline sale replayed under someone else's sign-in must not show
      -- its lines as rung by the person who merely sent it).
      begin
        if v_pk is not null then
          select o.staff_id, o.staff_trust, o.staff_session_id into v_parent
            from auditlog.log o
           where o.table_name = 'orders' and o.row_pk = v_pk and o.action = 'insert' and o.txid = txid_current()
           order by o.seq desc limit 1;
          if found then
            c.staff_id := v_parent.staff_id; c.staff_trust := v_parent.staff_trust;
            c.staff_session_id := v_parent.staff_session_id;
          end if;
        end if;
      exception when others then null;
      end;
      -- Lines are only ever written by create_order_with_items. A line
      -- added to a sale any other way from a till is not the app.
      if c.actor in ('till', 'member', 'anon') and not auditlog.via_is_app_function(coalesce(c.via, '')) then
        sev := 3; flags := array_append(flags, 'direct_insert_of_sale_line');
      end if;

    else
      select count(*), jsonb_agg(j), min(j ->> 'id'),
             bool_or(j ->> 'type' in ('wastage', 'spillage', 'staff_drink', 'adjustment'))
        into v_n, v_rows, v_pk, v_below
        from (select to_jsonb(r) as j from new_rows r) x
       where not (TG_TABLE_NAME = 'stock_movements' and j ->> 'type' = 'sale'
                  and coalesce(c.via, '') like '%/rpc/create_order_with_items');
      if coalesce(v_n, 0) = 0 then return null; end if;
      if v_n > 1 then v_pk := null; end if;
      if v_below then sev := greatest(sev, 1); end if;
    end if;

    det := det || jsonb_build_object('rows', v_n);
    if array_length(flags, 1) > 0 then
      det := det || jsonb_build_object('flags', to_jsonb(flags));
    end if;
    perform auditlog.write(c, 'row', 'insert', sev, TG_TABLE_NAME, v_pk, null, v_rows, null, det);
  exception when others then
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('capture_insert_bulk', sqlerrm, TG_TABLE_NAME, TG_OP);
    exception when others then
      raise warning 'audit: bulk capture failed on % and could not be recorded: %', TG_TABLE_NAME, sqlerrm;
    end;
  end;
  return null;
end;
$$;

create or replace function auditlog.capture_truncate()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
begin
  begin
    perform auditlog.write(auditlog.ctx(), 'row', 'truncate', 3, TG_TABLE_NAME, null, null, null, null,
      jsonb_build_object('flags', jsonb_build_array('table_emptied')));
  exception when others then
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('capture_truncate', sqlerrm, TG_TABLE_NAME, 'TRUNCATE');
    exception when others then null;
    end;
  end;
  return null;
end;
$$;

-- ── 6. Ledger guards ─────────────────────────────────────────────────────

-- Before this, a till session could DELETE or rewrite any sale, stock
-- movement, tab adjustment or payment correction with a single REST call
-- (the "Till device full access" policies are FOR ALL) and leave no trace.
--
-- mode 'immutable'  : rows may be inserted, never updated or deleted
-- mode 'no_delete'  : rows may be inserted and updated, never deleted
--
-- Applies only to DIRECT table access by an API caller (till, member,
-- anon). The app's own functions (/rpc/...) are trusted code and are not
-- restricted; nor are the service key or the SQL editor, whose writes are
-- recorded at alert level by the capture trigger instead — the owner must
-- still be able to repair data by hand.
--
-- A refused row is skipped (the statement reports 0 rows affected) and the
-- attempt is logged at severity 3. Fails OPEN: if the guard itself errors,
-- the write goes ahead and the failure is recorded.
create or replace function auditlog.guard_ledger()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context;
  v_mode text := coalesce(TG_ARGV[0], 'immutable');
  v_pkcol text := coalesce(TG_ARGV[1], 'id');
  v_enforced boolean;
  v_refuse boolean := false;
begin
  begin
    if TG_OP = 'DELETE' or v_mode = 'immutable' then
      c := auditlog.ctx();
      if c.actor in ('till', 'member', 'anon') and not auditlog.via_is_app_function(coalesce(c.via, '')) then
        v_enforced := coalesce((select guards_enforced from auditlog.settings), true);
        perform auditlog.write(c, 'guard',
          case when v_enforced then 'blocked.' else 'would_block.' end || lower(TG_OP), 3,
          TG_TABLE_NAME, to_jsonb(OLD) ->> v_pkcol,
          auditlog.scrub(TG_TABLE_NAME, to_jsonb(OLD)),
          case when TG_OP = 'UPDATE' then auditlog.scrub(TG_TABLE_NAME, to_jsonb(NEW)) end,
          null,
          jsonb_build_object('rule', v_mode, 'flags', jsonb_build_array('history_rewrite_attempt')));
        v_refuse := v_enforced;
      end if;
    end if;
  exception when others then
    v_refuse := false;
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('guard_ledger', sqlerrm, TG_TABLE_NAME, TG_OP);
    exception when others then null;
    end;
  end;

  if v_refuse then
    return null;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- Which tables are guarded, and how. One list, used to create the guard
-- triggers and by coverage() to check they are still there.
--   immutable : rows may be inserted, never updated or deleted from a till
--   no_delete : rows may be inserted and updated, never deleted from a till
-- pk is the column a refused attempt is filed under (sale lines are filed
-- under their order, so a sale's history shows what was tried on its lines).
create or replace function auditlog.guard_rules()
returns table (table_name text, mode text, pk text)
language sql
immutable
as $$
  values
    ('order_items', 'immutable', 'order_id'),
    ('stock_movements', 'immutable', 'id'),
    ('tab_adjustments', 'immutable', 'id'),
    ('order_corrections', 'immutable', 'id'),
    ('cashback_transactions', 'immutable', 'id'),
    ('prize_wins', 'immutable', 'id'),
    ('guest_signins', 'immutable', 'id'),
    ('product_price_changes', 'immutable', 'id'),
    ('tab_payments', 'immutable', 'id'),
    ('orders', 'no_delete', 'id'),
    ('members', 'no_delete', 'id'),
    ('products', 'no_delete', 'id'),
    ('z_reports', 'no_delete', 'id'),
    ('staff_drink_credits', 'no_delete', 'id')
$$;

-- A member's PIN, tab balance, login link and settlement stamp are only
-- ever changed by functions (staff_set_pin, the tab functions, the invite
-- and Stripe functions). A till writing them straight into the row is not
-- the app — and for pin_hash it would be a way to give a colleague a PIN of
-- your choosing and then sign in as them, "PIN checked".
--
-- A direct write to these columns from an API caller is put back to what it
-- was (the rest of the update still applies) and recorded as serious; a new
-- member inserted with any of them already set has them blanked. With
-- guards_enforced off it is recorded only. Fails open like every guard.
create or replace function auditlog.guard_member_fields()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context;
  v_cols text[] := '{}';
  v_enforced boolean;
  v_old jsonb;
  v_new jsonb;
begin
  begin
    if TG_OP = 'INSERT' then
      -- A member created by the app arrives with none of these set.
      if new.pin_hash is not null then v_cols := array_append(v_cols, 'pin_hash'); end if;
      if coalesce(new.tab_balance, 0) <> 0 then v_cols := array_append(v_cols, 'tab_balance'); end if;
      if new.auth_user_id is not null then v_cols := array_append(v_cols, 'auth_user_id'); end if;
      if new.last_settled_at is not null then v_cols := array_append(v_cols, 'last_settled_at'); end if;
    else
      if new.pin_hash is distinct from old.pin_hash then v_cols := array_append(v_cols, 'pin_hash'); end if;
      if new.tab_balance is distinct from old.tab_balance then v_cols := array_append(v_cols, 'tab_balance'); end if;
      if new.auth_user_id is distinct from old.auth_user_id then v_cols := array_append(v_cols, 'auth_user_id'); end if;
      if new.last_settled_at is distinct from old.last_settled_at then v_cols := array_append(v_cols, 'last_settled_at'); end if;
    end if;

    if array_length(v_cols, 1) > 0 then
      c := auditlog.ctx();
      if c.actor in ('till', 'member', 'anon') and not auditlog.via_is_app_function(coalesce(c.via, '')) then
        v_enforced := coalesce((select guards_enforced from auditlog.settings), true);
        if TG_OP = 'UPDATE' then
          select jsonb_object_agg(e.key, e.value) into v_old from jsonb_each(to_jsonb(old)) e where e.key = any (v_cols);
        end if;
        select jsonb_object_agg(e.key, e.value) into v_new from jsonb_each(to_jsonb(new)) e where e.key = any (v_cols);
        perform auditlog.write(c, 'guard',
          case when v_enforced then 'blocked.' else 'would_block.' end || lower(TG_OP), 3,
          'members', new.id::text,
          auditlog.scrub('members', v_old), auditlog.scrub('members', v_new), v_cols,
          jsonb_build_object('rule', 'protected_fields',
            'flags', jsonb_build_array('direct_edit_of_protected_field')));
        if v_enforced then
          if TG_OP = 'INSERT' then
            new.pin_hash := null;
            new.tab_balance := 0;
            new.auth_user_id := null;
            new.last_settled_at := null;
          else
            new.pin_hash := old.pin_hash;
            new.tab_balance := old.tab_balance;
            new.auth_user_id := old.auth_user_id;
            new.last_settled_at := old.last_settled_at;
          end if;
        end if;
      end if;
    end if;
  exception when others then
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('guard_member_fields', sqlerrm, 'members', TG_OP);
    exception when others then null;
    end;
  end;
  return new;
end;
$$;

-- ── 7. Staff sign-in and PINs, in the database ───────────────────────────

-- Until now the PIN was checked by the verify-pin edge function, which told
-- the BROWSER "valid" and nothing else: the database never learned who had
-- signed in, so every staff id it stored was whatever the browser chose to
-- send. Checking the PIN here lets the server mint a session it can
-- recognise on every later request.
--
-- Shares pin_attempts with verify-pin (same rule: 5 wrong PINs lock that
-- person for 15 minutes; success clears the count) so the lockout cannot be
-- sidestepped by alternating between the two.
--
-- Hashes are bcrypt written by bcryptjs ("$2b$10$..."). pgcrypto's crypt()
-- implements the same algorithm but only recognises the "$2a$" spelling of
-- the prefix, so the prefix is swapped for the comparison (verified against
-- real bcryptjs output in supabase/tests). An unrecognised hash raises, and
-- the till falls back to verify-pin.
create or replace function auditlog.check_pin(p_member_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  m record;
  a record;
  v_failed int := 0;
  v_hash text;
  v_new int;
  v_remaining int;
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then
    return jsonb_build_object('valid', false, 'error', 'PIN must be exactly 4 digits');
  end if;

  select id, name, pin_hash, membership_tier into m from public.members where id = p_member_id;
  if not found or m.membership_tier is distinct from 'staff' then
    return jsonb_build_object('valid', false, 'outcome', 'not_staff');
  end if;
  if m.pin_hash is null then
    return jsonb_build_object('valid', false, 'reason', 'no_pin', 'outcome', 'no_pin', 'name', m.name);
  end if;

  -- One PIN check per person at a time: without this, a burst of parallel
  -- guesses could all read "no failures yet" before any of them is counted.
  perform pg_advisory_xact_lock(hashtextextended('auditlog.pin:' || p_member_id::text, 0));

  select failed_count, locked_until into a from public.pin_attempts where member_id = p_member_id for update;
  if found then
    if a.locked_until is not null and a.locked_until > now() then
      -- Locked: do not even compare, so a locked PIN gives no hint.
      return jsonb_build_object('valid', false, 'reason', 'locked', 'outcome', 'locked', 'name', m.name,
        'retryAfterSeconds', ceil(extract(epoch from (a.locked_until - now())))::int);
    end if;
    v_failed := case when a.locked_until is not null then 0 else coalesce(a.failed_count, 0) end;
  end if;

  if m.pin_hash !~ '^\$2[abxy]\$\d\d\$' or length(m.pin_hash) <> 60 then
    raise exception 'unsupported PIN hash format' using errcode = 'feature_not_supported';
  end if;
  v_hash := '$2a$' || substr(m.pin_hash, 5);

  if crypt(p_pin, v_hash) = v_hash then
    delete from public.pin_attempts where member_id = p_member_id;
    return jsonb_build_object('valid', true, 'outcome', 'ok', 'name', m.name);
  end if;

  v_new := v_failed + 1;
  insert into public.pin_attempts (member_id, failed_count, locked_until, updated_at)
  values (p_member_id,
          case when v_new >= 5 then 0 else v_new end,
          case when v_new >= 5 then now() + interval '15 minutes' end,
          now())
  on conflict (member_id) do update
    set failed_count = excluded.failed_count,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at;

  if v_new >= 5 then
    return jsonb_build_object('valid', false, 'reason', 'locked', 'outcome', 'locked_now', 'name', m.name,
      'retryAfterSeconds', 15 * 60);
  end if;
  v_remaining := 5 - v_new;
  return jsonb_build_object('valid', false, 'outcome', 'wrong_pin', 'name', m.name,
    'attemptsRemaining', v_remaining);
end;
$$;

-- Opens a staff session on the calling till device and returns its token.
-- Internal: the public entry points below decide the trust level.
create or replace function auditlog.open_session(p_ctx auditlog.context, p_staff_id uuid, p_trust text)
returns jsonb
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  c auditlog.context := p_ctx;
begin
  -- One person per till at a time: whoever was signed in here is signed out.
  update auditlog.staff_sessions
     set ended_at = now(), end_reason = 'replaced'
   where device = c.auth_uid and ended_at is null;

  insert into auditlog.staff_sessions (staff_id, device, till_id, token_hash, trust, origin_id)
  values (p_staff_id, c.auth_uid, c.till_id, sha256(convert_to(v_token, 'utf8')), p_trust, c.origin_id)
  returning id into v_id;

  -- The rest of this request is this person's.
  c.staff_id := p_staff_id;
  c.staff_trust := p_trust;
  c.staff_session_id := v_id;
  perform set_config('auditlog.ctx_cache', to_jsonb(c)::text, true);

  perform auditlog.try_write(c, 'auth', 'staff.sign_in', case when p_trust = 'pin' then 0 else 1 end,
    'members', p_staff_id::text, null, null, null,
    jsonb_build_object('trust', p_trust));

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- Sign in with a PIN. Same response shape as the verify-pin edge function
-- ({valid, member} / {valid:false, reason, retryAfterSeconds, attemptsRemaining})
-- plus `session` on success, so the till can treat the two alike.
create or replace function public.staff_sign_in(p_member_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  r jsonb;
  v_session jsonb;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;

  r := auditlog.check_pin(p_member_id, p_pin);

  if (r ->> 'valid')::boolean then
    v_session := auditlog.open_session(c, p_member_id, 'pin');
    return jsonb_build_object('valid', true,
      'member', jsonb_build_object('id', p_member_id, 'name', r ->> 'name'),
      'session', v_session);
  end if;

  if r ? 'outcome' then
    perform auditlog.try_write(c, 'auth', 'pin.' || (r ->> 'outcome'),
      case r ->> 'outcome' when 'wrong_pin' then 1 when 'no_pin' then 0 else 2 end,
      'members', p_member_id::text, null, null, null,
      jsonb_build_object('purpose', 'sign_in', 'attempts_remaining', r -> 'attemptsRemaining'));
  end if;
  return r - 'outcome' - 'name';
end;
$$;

-- Re-check the signed-in person's PIN before a sensitive action (the
-- PinGate: Z report, price change, payment fix, undo tab payment). Creates
-- no session; records what the PIN was asked FOR.
create or replace function public.staff_verify_pin(p_member_id uuid, p_pin text, p_purpose text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  r jsonb;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;

  r := auditlog.check_pin(p_member_id, p_pin);
  if r ? 'outcome' then
    perform auditlog.try_write(c, 'auth',
      case when (r ->> 'valid')::boolean then 'pin.confirmed' else 'pin.' || (r ->> 'outcome') end,
      case r ->> 'outcome' when 'ok' then 0 when 'wrong_pin' then 1 when 'no_pin' then 0 else 2 end,
      'members', p_member_id::text, null, null, null,
      jsonb_build_object('purpose', left(coalesce(p_purpose, 'confirm'), 80),
        'attempts_remaining', r -> 'attemptsRemaining',
        'for_signed_in_person', c.staff_id is not distinct from p_member_id));
  end if;
  return r - 'outcome' - 'name';
end;
$$;

-- Can this database check this person's PIN itself? False only when the
-- stored hash is in a form crypt() cannot read, or pgcrypto is not usable
-- here — the two cases the legacy fallback exists for.
create or replace function auditlog.can_check_pin(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from public.members where id = p_member_id;
  if v_hash is null or v_hash !~ '^\$2[abxy]\$\d\d\$' or length(v_hash) <> 60 then
    return false;
  end if;
  -- Proves crypt() exists and accepts a bcrypt salt, at the cheapest cost.
  perform crypt('0000', '$2a$04$abcdefghijklmnopqrstuu');
  return true;
exception when others then
  return false;
end;
$$;

-- Fallback for when staff_sign_in cannot check a PIN (unrecognised hash, or
-- no pgcrypto): the till verified the PIN with the legacy verify-pin
-- function and now registers who it says signed in. The session is marked
-- 'claimed' and every entry made under it says so.
--
-- Refused whenever this database CAN check the PIN itself — otherwise it
-- would be a way to sign in as a colleague without knowing their PIN. The
-- refusal is recorded.
create or replace function public.staff_session_claim(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  v_name text;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;
  select name into v_name from public.members where id = p_member_id and membership_tier = 'staff';
  if not found then
    raise exception 'not a staff member';
  end if;
  if auditlog.can_check_pin(p_member_id) then
    perform auditlog.try_write(c, 'auth', 'session.claim_refused', 2, 'members', p_member_id::text, null, null, null,
      jsonb_build_object('note', 'A till tried to register a sign-in without the database checking the PIN.'));
    return jsonb_build_object('valid', false, 'reason', 'use_staff_sign_in');
  end if;
  return jsonb_build_object('valid', true,
    'member', jsonb_build_object('id', p_member_id, 'name', v_name),
    'session', auditlog.open_session(c, p_member_id, 'claimed'));
end;
$$;

-- End a staff session on this till. The till passes the token explicitly
-- (p_token) because it forgets the token the instant someone signs out —
-- usually before the request carrying it in a header has even been built.
-- With no p_token, the session on this request's header is ended.
create or replace function public.staff_sign_out(p_reason text default 'sign_out', p_token text default null)
returns boolean
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  s record;
begin
  if c.actor is distinct from 'till' then
    return false;
  end if;

  if nullif(p_token, '') is not null then
    select ss.id, ss.staff_id, ss.trust into s
      from auditlog.staff_sessions ss
     where ss.token_hash = sha256(convert_to(p_token, 'utf8'))
       and ss.device = c.auth_uid and ss.ended_at is null;
    if not found then
      return false;
    end if;
    -- The entry belongs to the person signing out, whatever the header says.
    c.staff_id := s.staff_id;
    c.staff_trust := s.trust;
    c.staff_session_id := s.id;
  elsif c.staff_session_id is null then
    return false;
  end if;

  perform auditlog.try_write(c, 'auth', 'staff.sign_out', 0, 'members', c.staff_id::text, null, null, null,
    jsonb_build_object('reason', left(coalesce(p_reason, 'sign_out'), 40)));
  update auditlog.staff_sessions
     set ended_at = now(), end_reason = left(coalesce(p_reason, 'sign_out'), 40)
   where id = c.staff_session_id and ended_at is null;
  -- Later statements in this request must not be attributed to an ended session.
  perform set_config('auditlog.ctx_cache', '', true);
  return true;
end;
$$;

-- Set or change a staff PIN. Mirrors verify-pin's "set" mode (staff only;
-- changing an existing PIN needs the current one, with the shared lockout)
-- but runs here so the change is recorded against a till and a signed-in
-- person instead of an anonymous service call.
create or replace function public.staff_set_pin(p_member_id uuid, p_new_pin text, p_current_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  m record;
  r jsonb;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;
  if p_new_pin is null or p_new_pin !~ '^\d{4}$' then
    return jsonb_build_object('error', 'PIN must be exactly 4 digits');
  end if;

  select id, pin_hash, membership_tier into m from public.members where id = p_member_id for update;
  if not found or m.membership_tier is distinct from 'staff' then
    return jsonb_build_object('error', 'Unauthorized');
  end if;

  if m.pin_hash is not null then
    if p_current_pin is null then
      return jsonb_build_object('error', 'current_pin required to change an existing PIN');
    end if;
    r := auditlog.check_pin(p_member_id, p_current_pin);
    if not (r ->> 'valid')::boolean then
      perform auditlog.try_write(c, 'auth', 'pin.' || coalesce(r ->> 'outcome', 'rejected'), 2,
        'members', p_member_id::text, null, null, null, jsonb_build_object('purpose', 'change_pin'));
      if r ->> 'reason' = 'locked' then
        return r - 'outcome' - 'name';
      end if;
      return jsonb_build_object('error', 'Incorrect current PIN');
    end if;
  end if;

  update public.members set pin_hash = crypt(p_new_pin, gen_salt('bf', 10)) where id = p_member_id;

  perform auditlog.try_write(c, 'auth',
    case when m.pin_hash is null then 'pin.first_set' else 'pin.changed' end,
    -- A first PIN needs no proof of identity (that is how a new starter
    -- gets one), so it is always worth a glance: whoever sets it becomes
    -- that person at the till.
    case when m.pin_hash is null then 2 else 1 end,
    'members', p_member_id::text, null, null, null,
    jsonb_build_object('set_by_self', c.staff_id is not distinct from p_member_id));
  return jsonb_build_object('success', true);
end;
$$;

-- ── 8. Client events ─────────────────────────────────────────────────────

-- Things that matter but write no row: a line taken off an order before
-- payment, the drawer opened without a sale, a report exported, a setting
-- changed, the till going offline. The till queues these (surviving
-- reloads and offline spells) and sends them in batches.
--
-- Each event carries a client-generated id, so a batch re-sent after a
-- dropped connection is not recorded twice, and the id of the staff session
-- it happened under, which is checked against our own session table: an
-- event is only attributed with confidence to a session that belonged to
-- this device and was open at the time.
--
-- Event contents are the till's own account of what happened (kind =
-- 'event'): useful evidence, but unlike row changes not something the
-- database witnessed.
create or replace function public.audit_log_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  e auditlog.context;
  ev jsonb;
  s record;
  v_at timestamptz;
  v_id uuid;
  v_type text;
  v_detail jsonb;
  v_accepted int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  for ev in select value from jsonb_array_elements(p_events) limit 200 loop
    begin
      v_type := ev ->> 'type';
      if v_type is null or v_type !~ '^[a-z][a-z0-9_.]{1,79}$' then
        v_rejected := v_rejected + 1;
        continue;
      end if;
      v_id := (ev ->> 'id')::uuid;
      v_at := (ev ->> 'at')::timestamptz;
      v_detail := ev -> 'detail';
      if v_detail is not null and length(v_detail::text) > 6000 then
        v_detail := jsonb_build_object('truncated', true, 'bytes', length(v_detail::text));
      end if;

      e := c;
      e.staff_id := null; e.staff_trust := 'none'; e.staff_session_id := null;
      if ev ->> 'session_id' is not null then
        -- A session id is not a secret. Quoting one only earns "PIN
        -- checked" when it is the session THIS request proved with its
        -- token. Any other session of this device (events queued earlier
        -- and sent after a change of user) must have been open at the
        -- time the event says it happened, and is labelled as a match
        -- against the sign-in record, not as PIN checked.
        select ss.id, ss.staff_id, ss.trust into s
          from auditlog.staff_sessions ss
         where ss.id = (ev ->> 'session_id')::uuid and ss.device = c.auth_uid
           and (v_at is not null or ss.id = c.staff_session_id)
           and (v_at is null or (ss.started_at <= v_at + interval '2 minutes'
                                 and coalesce(ss.ended_at, now()) >= v_at - interval '2 minutes'));
        if found then
          e.staff_id := s.staff_id; e.staff_session_id := s.id;
          e.staff_trust := case when s.id = c.staff_session_id then s.trust
                                when s.trust = 'pin' then 'session_record'
                                else 'claimed' end;
        end if;
      end if;
      if e.staff_id is null and ev ->> 'staff_id' is not null then
        e.staff_id := (ev ->> 'staff_id')::uuid;
        e.staff_trust := 'claimed';
      end if;

      if auditlog.write(e, 'event', v_type, least(coalesce((ev ->> 'severity')::int, 0), 2),
                     null, null, null, null, null, v_detail, v_at, v_id) is null then
        v_duplicate := v_duplicate + 1;
      else
        v_accepted := v_accepted + 1;
      end if;
    exception when others then
      v_rejected := v_rejected + 1;
    end;
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'duplicate', v_duplicate, 'rejected', v_rejected);
end;
$$;

-- What does the server see on this request? The till calls this once at
-- start-up to prove its extra headers (x-staff-session, x-app-build) get
-- through the gateway before it attaches them to every request, and the
-- viewer uses it to show "signed in as ... (PIN checked)".
create or replace function public.audit_ping()
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context;
  h json;
begin
  -- Anyone else gets a bare answer and causes no work (and no rows).
  if not coalesce(public.is_till_device(auth.uid()), false) then
    return jsonb_build_object('ok', true, 'actor', 'other');
  end if;
  c := auditlog.ctx();
  begin h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then h := null; end;
  return jsonb_build_object(
    'ok', true,
    'actor', c.actor,
    'till_id', c.till_id,
    'staff_id', c.staff_id,
    'staff_trust', c.staff_trust,
    'saw_staff_header', h ->> 'x-staff-session' is not null,
    'saw_build_header', h ->> 'x-app-build' is not null);
end;
$$;

-- ── 9. Sealing and verification ──────────────────────────────────────────

-- Append-only triggers stop a till, the service key and a careless SQL
-- statement. They do not stop someone with full database access who is
-- prepared to switch the triggers off. Sealing makes THAT detectable:
-- every few minutes the rows written since the last seal are hashed
-- together with the previous seal's hash, so changing, removing or adding
-- any sealed row breaks every seal after it. A seal's short code is shown
-- in the app, remembered by each till and included in the Z-report email,
-- so there are copies of it outside the database to compare against.
--
-- Sealing runs from pg_cron, never inside a sale: writers take no lock.
-- Membership is explicit (each row is stamped with its seal id), so a row
-- that commits late simply lands in the next seal.
create or replace function auditlog.seal()
returns bigint
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v_seqs bigint[];
  v_rows_hash bytea;
  v_prev bytea;
  v_id bigint;
  v_last bigint := null;
begin
  -- One sealer at a time. Only other sealers ever wait on this.
  perform pg_advisory_xact_lock(hashtext('auditlog.seal'));
  perform set_config('auditlog.sealing', 'on', true);

  loop
    select array_agg(seq order by seq), sha256(string_agg(row_hash, ''::bytea order by seq))
      into v_seqs, v_rows_hash
      from (select seq, row_hash from auditlog.log where seal_id is null order by seq limit 5000) u;
    exit when v_seqs is null;

    select hash into v_prev from auditlog.seals order by id desc limit 1;

    insert into auditlog.seals (first_seq, last_seq, row_count, rows_hash, prev_hash, hash)
    values (v_seqs[1], v_seqs[array_upper(v_seqs, 1)], array_length(v_seqs, 1), v_rows_hash, v_prev, '\x')
    returning id into v_id;

    update auditlog.seals
       set hash = auditlog.seal_digest(v_id, v_seqs[1], v_seqs[array_upper(v_seqs, 1)],
                                    array_length(v_seqs, 1), v_rows_hash, v_prev)
     where id = v_id;

    update auditlog.log set seal_id = v_id where seq = any (v_seqs) and seal_id is null;
    v_last := v_id;
  end loop;

  perform set_config('auditlog.sealing', '', true);
  return v_last;
end;
$$;

create or replace function auditlog.seal_digest(p_id bigint, p_first bigint, p_last bigint,
                                             p_count int, p_rows_hash bytea, p_prev bytea)
returns bytea
language sql
immutable
as $$
  select sha256(coalesce(p_prev, ''::bytea)
    || convert_to(p_id || '|' || p_first || '|' || p_last || '|' || p_count || '|', 'utf8')
    || p_rows_hash)
$$;

-- A seal as people see it: "S42-4F2A-91BC".
create or replace function auditlog.seal_code(p_id bigint, p_hash bytea)
returns text
language sql
immutable
as $$
  select 'S' || p_id || '-' || upper(substr(encode(p_hash, 'hex'), 1, 4))
             || '-' || upper(substr(encode(p_hash, 'hex'), 5, 4))
$$;

-- auditlog.seals needs one update (filling in its own hash, which includes its
-- id) inside seal(); everything else is refused by append_only.
create or replace function auditlog.seals_guard()
returns trigger
language plpgsql
set search_path = auditlog, public
as $$
begin
  if TG_OP = 'UPDATE'
     and current_setting('auditlog.sealing', true) = 'on'
     and old.hash = '\x'::bytea
     and (to_jsonb(new) - 'hash') = (to_jsonb(old) - 'hash') then
    return new;
  end if;
  raise exception 'auditlog.seals is append-only (% refused)', TG_OP using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists append_only on auditlog.seals;
create trigger append_only before update or delete on auditlog.seals
  for each row execute function auditlog.seals_guard();

-- Recomputes from the stored rows and reports the first problems found.
-- ok = true means: every checked row still hashes to what was recorded when
-- it was written, no sealed row is missing or added, and the chain of seals
-- is unbroken from the first to the last.
--
-- p_since null  = everything (the nightly job).
-- p_since given = the chain of ALL seals is still walked (cheap: seals
--                 only), but row contents are re-hashed only for seals made
--                 since then. This is what "Check now" uses once the log is
--                 large, so it always answers within the API's time limit;
--                 the result says which it was ('scope').
create or replace function auditlog.verify(p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  s record;
  v_prev bytea := null;
  v_first boolean := true;
  v_problems jsonb := '[]'::jsonb;
  v_n int;
  v_bad bigint;
  v_rows_hash bytea;
  v_rows bigint := 0;
  v_seals int := 0;
  v_content_seals int := 0;
  v_head record;
  v_unsealed bigint;
begin
  for s in select * from auditlog.seals order by id loop
    v_seals := v_seals + 1;

    if s.prev_hash is distinct from v_prev and not (v_first and s.prev_hash is null) then
      v_problems := v_problems || jsonb_build_object('seal', s.id, 'problem', 'chain_broken');
    end if;
    if s.hash is distinct from auditlog.seal_digest(s.id, s.first_seq, s.last_seq, s.row_count, s.rows_hash, s.prev_hash) then
      v_problems := v_problems || jsonb_build_object('seal', s.id, 'problem', 'seal_altered');
    end if;

    if p_since is null or s.sealed_at >= p_since then
      v_content_seals := v_content_seals + 1;
      select count(*), sha256(string_agg(row_hash, ''::bytea order by seq)),
             min(seq) filter (where erased_at is null and row_hash <> auditlog.row_digest(l))
        into v_n, v_rows_hash, v_bad
        from auditlog.log l where l.seal_id = s.id;
      v_rows := v_rows + v_n;

      if v_bad is not null then
        v_problems := v_problems || jsonb_build_object('seal', s.id, 'problem', 'row_content_changed', 'seq', v_bad);
      end if;
      if v_n <> s.row_count then
        v_problems := v_problems || jsonb_build_object('seal', s.id, 'problem', 'row_count_changed',
          'expected', s.row_count, 'found', v_n);
      end if;
      if v_rows_hash is distinct from s.rows_hash then
        v_problems := v_problems || jsonb_build_object('seal', s.id, 'problem', 'rows_do_not_match_seal');
      end if;
    end if;

    v_prev := s.hash;
    v_first := false;
    exit when jsonb_array_length(v_problems) >= 20;
  end loop;

  -- Rows pointing at a seal that no longer exists.
  select count(*) into v_n from auditlog.log l
   where l.seal_id is not null and not exists (select 1 from auditlog.seals s2 where s2.id = l.seal_id);
  if v_n > 0 then
    v_problems := v_problems || jsonb_build_object('problem', 'seal_missing', 'rows', v_n);
  end if;

  -- Rows not yet sealed must at least still match their own hash.
  select count(*), min(seq) filter (where erased_at is null and row_hash <> auditlog.row_digest(l))
    into v_unsealed, v_bad from auditlog.log l where l.seal_id is null;
  if v_bad is not null then
    v_problems := v_problems || jsonb_build_object('problem', 'unsealed_row_content_changed', 'seq', v_bad);
  end if;

  -- An erased entry's content cannot be re-hashed, so it must be accounted
  -- for another way: it has to be a member row, and there has to be a
  -- recorded erasure of that member. Anything else is tampering dressed up
  -- as an erasure.
  select count(*), min(l.seq) into v_n, v_bad from auditlog.log l
   where l.erased_at is not null
     and (l.table_name is distinct from 'members'
          or not exists (select 1 from auditlog.log e
                          where e.kind = 'system' and e.action = 'privacy.erased' and e.row_pk = l.row_pk));
  if v_n > 0 then
    v_problems := v_problems || jsonb_build_object('problem', 'erased_without_record', 'rows', v_n, 'seq', v_bad);
  end if;

  -- ... and what it says now must be what was recorded at the erasure.
  select count(*), min(l.seq) into v_n, v_bad from auditlog.log l
   where l.erased_at is not null
     and not exists (select 1 from auditlog.log e
                      where e.kind = 'system' and e.action = 'privacy.erased_rows' and e.row_pk = l.row_pk
                        and e.detail -> 'rows' ->> l.seq::text = encode(auditlog.content_digest(l), 'hex'));
  if v_n > 0 then
    v_problems := v_problems || jsonb_build_object('problem', 'erased_row_content_changed', 'rows', v_n, 'seq', v_bad);
  end if;

  select id, hash, sealed_at into v_head from auditlog.seals order by id desc limit 1;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_problems) = 0,
    'scope', case when p_since is null then 'everything' else 'recent' end,
    'since', p_since,
    'seals_checked', v_seals,
    'seals_rehashed', v_content_seals,
    'rows_checked', v_rows + v_unsealed,
    'unsealed_rows', v_unsealed,
    'problems', v_problems,
    'head', case when v_head.id is null then null else jsonb_build_object(
      'id', v_head.id, 'code', auditlog.seal_code(v_head.id, v_head.hash),
      'hash', encode(v_head.hash, 'hex'), 'sealed_at', v_head.sealed_at) end);
end;
$$;

-- Is every protection still in place? For every trigger this file creates
-- (capture on each table, per-statement capture on the two ledgers, the
-- guards, the member-field guard, and the log's own append-only triggers)
-- reports any that is
--   missing   : not there (dropped, or a table created since)
--   disabled  : there but not firing for ordinary sessions (state other
--               than 'O'/'A' — 'D' disabled, 'R' replica-only)
--   repointed : there, but no longer calling this file's function
create or replace function auditlog.coverage()
returns jsonb
language sql
security definer
set search_path = auditlog, public
as $$
  with pub as (
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ), expected (rel, label, trig, fn) as (
    select p.oid, p.relname, 'zz_audit_capture', 'capture_row' from pub p
    union all
    select p.oid, p.relname || ':truncate', 'zz_audit_truncate', 'capture_truncate' from pub p
    union all
    select p.oid, p.relname || ':insert', 'zz_audit_capture_insert', 'capture_insert_bulk'
      from pub p where p.relname in ('order_items', 'stock_movements')
    union all
    select p.oid, p.relname || ':guard', 'aa_audit_guard', 'guard_ledger'
      from pub p join auditlog.guard_rules() g on g.table_name = p.relname
    union all
    select p.oid, 'members:protected_fields', 'aa_audit_guard_fields', 'guard_member_fields'
      from pub p where p.relname = 'members'
    union all
    select c.oid, 'auditlog.' || c.relname || ':' || x.trig, x.trig, x.fn
      from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'auditlog'
      join (values ('log', 'append_only', 'append_only'), ('log', 'append_only_truncate', 'append_only'),
                   ('log', 'log_before_insert', 'log_before_insert'),
                   ('seals', 'append_only', 'seals_guard'), ('seals', 'append_only_truncate', 'append_only'),
                   ('acks', 'append_only', 'append_only'), ('acks', 'append_only_truncate', 'append_only'),
                   ('origins', 'append_only', 'append_only'), ('origins', 'append_only_truncate', 'append_only'),
                   ('device_ips', 'append_only', 'append_only'), ('device_ips', 'append_only_truncate', 'append_only'),
                   ('staff_sessions', 'append_only', 'append_only'), ('staff_sessions', 'append_only_truncate', 'append_only'),
                   ('manifests', 'append_only', 'append_only'), ('manifests', 'append_only_truncate', 'append_only')
           ) as x (tbl, trig, fn) on x.tbl = c.relname
  ), state as (
    select e.label,
           tg.tgenabled,
           (select pn.nspname || '.' || pp.proname from pg_proc pp join pg_namespace pn on pn.oid = pp.pronamespace
             where pp.oid = tg.tgfoid) as calls,
           e.fn
      from expected e
      left join pg_trigger tg on tg.tgrelid = e.rel and tg.tgname = e.trig and not tg.tgisinternal
  )
  select jsonb_build_object(
    'tables', (select count(*) from pub),
    'missing', coalesce((select jsonb_agg(label order by label) from state where tgenabled is null), '[]'::jsonb),
    'disabled', coalesce((select jsonb_agg(label order by label) from state
                           where tgenabled is not null and tgenabled not in ('O', 'A')), '[]'::jsonb),
    'repointed', coalesce((select jsonb_agg(label order by label) from state
                            where tgenabled is not null and calls is distinct from 'auditlog.' || fn), '[]'::jsonb))
$$;

-- A fingerprint of the audit layer's own code: every function in schema
-- auditlog, the public staff_* / audit_* / price-log functions, and every
-- audit trigger definition. coverage() can see a trigger that is gone or
-- switched off; it cannot see one whose function has been quietly replaced
-- with something that does nothing. This can.
--
-- The accepted fingerprint is stored (append-only). The nightly check
-- raises a serious alert when the live code no longer matches it. A
-- migration that legitimately changes this code must end with
--   select auditlog.accept_manifest('<why>');
-- which is itself recorded.
create table if not exists auditlog.manifests (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  digest text not null,
  reason text
);

drop trigger if exists append_only on auditlog.manifests;
create trigger append_only before update or delete on auditlog.manifests
  for each row execute function auditlog.append_only();
drop trigger if exists append_only_truncate on auditlog.manifests;
create trigger append_only_truncate before truncate on auditlog.manifests
  for each statement execute function auditlog.append_only();

create or replace function auditlog.manifest()
returns text
language sql
stable
security definer
set search_path = auditlog, public
as $$
  select md5(coalesce((
    select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f'
       and (n.nspname = 'auditlog'
            or (n.nspname = 'public' and (p.proname like 'staff\_%' or p.proname like 'audit\_%'
                                         or p.proname like 'log\_product\_price\_%')))), '')
    -- Triggers on the business tables: the SET of distinct definitions with
    -- the table name taken out. Adding or dropping a table (and attaching
    -- to it the documented way) therefore changes nothing here — which
    -- tables are covered is coverage()'s job — but a trigger given a WHEN
    -- clause, different events or a different function does.
    || '|' || coalesce((
    select string_agg(d, ',' order by d)
      from (select distinct md5(regexp_replace(pg_get_triggerdef(tg.oid), ' ON [^ ]+ ', ' ON <table> ')) as d
              from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
             where not tg.tgisinternal and n.nspname = 'public'
               and tg.tgname in ('zz_audit_capture', 'zz_audit_capture_insert', 'zz_audit_truncate',
                                 'aa_audit_guard', 'aa_audit_guard_fields')) x), '')
    -- The log's own tables are a fixed set: each trigger, by table.
    || '|' || coalesce((
    select string_agg(md5(pg_get_triggerdef(tg.oid)), ',' order by c.relname, tg.tgname)
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not tg.tgisinternal and n.nspname = 'auditlog'), ''))
$$;

create or replace function auditlog.accept_manifest(p_reason text)
returns text
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v text := auditlog.manifest();
begin
  insert into auditlog.manifests (digest, reason) values (v, p_reason);
  perform auditlog.try_write(auditlog.ctx(), 'system', 'manifest.accepted', 2, null, null, null, null, null,
    jsonb_build_object('digest', v, 'reason', p_reason,
      'note', 'The audit layer''s own code was (re)accepted as genuine. Expected after a database update that touches it; otherwise worth asking who did this.'));
  return v;
end;
$$;

-- pg_cron entry points.
create or replace function auditlog.seal_job()
returns void
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
begin
  perform set_config('auditlog.via', 'cron:audit-seal', true);
  perform auditlog.seal();
exception when others then
  begin
    insert into auditlog.failures (source, error) values ('seal_job', sqlerrm);
  exception when others then null;
  end;
end;
$$;

create or replace function auditlog.nightly()
returns void
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v jsonb;
  cov jsonb;
  c auditlog.context;
  v_fail bigint;
begin
  perform set_config('auditlog.via', 'cron:audit-nightly', true);
  c := auditlog.ctx();
  perform auditlog.seal();
  v := auditlog.verify();
  cov := auditlog.coverage();
  select count(*) into v_fail from auditlog.failures where at > now() - interval '24 hours';

  perform auditlog.try_write(c, 'system',
    case when (v ->> 'ok')::boolean then 'integrity.ok' else 'integrity.FAILED' end,
    case when (v ->> 'ok')::boolean then 0 else 3 end,
    null, null, null, null, null, v);

  if jsonb_array_length(cov -> 'missing') > 0 or jsonb_array_length(cov -> 'disabled') > 0
     or jsonb_array_length(cov -> 'repointed') > 0 then
    perform auditlog.try_write(c, 'system', 'coverage.gap', 3, null, null, null, null, null, cov
      || jsonb_build_object('note', 'A table is not being recorded, or a protection has been removed, switched off or redirected.'));
  end if;
  if not coalesce((select capture_enabled and guards_enforced from auditlog.settings), false) then
    perform auditlog.try_write(c, 'system', 'settings.protection_off', 3, null, null, null, null, null,
      (select jsonb_build_object('capture_enabled', capture_enabled, 'guards_enforced', guards_enforced,
         'note', 'Recording or the ledger guards are switched off in the audit settings.') from auditlog.settings));
  end if;
  if auditlog.manifest() is distinct from (select digest from auditlog.manifests order by id desc limit 1) then
    perform auditlog.try_write(c, 'system', 'coverage.changed', 3, null, null, null, null, null,
      jsonb_build_object('note', 'The audit layer''s own code no longer matches the accepted version. Expected only after a database update that changes it (which should have re-accepted it) or a database engine upgrade.'));
  end if;
  if v_fail > 0 then
    perform auditlog.try_write(c, 'system', 'capture.failures', 2, null, null, null, null, null,
      jsonb_build_object('last_24h', v_fail));
  end if;

  -- pg_cron keeps a row per run; the seal job would add ~100k a year.
  begin
    execute 'delete from cron.job_run_details where end_time < now() - interval ''7 days''';
  exception when others then null;
  end;
exception when others then
  begin
    insert into auditlog.failures (source, error) values ('nightly', sqlerrm);
  exception when others then null;
  end;
end;
$$;

-- ── 10. Read API for the in-app viewer ───────────────────────────────────

-- Reading the log needs a signed-in staff member at a till, and looking is
-- itself recorded (at most once every five minutes per session, so paging
-- through does not bury the log in "log viewed" entries).
create or replace function auditlog.require_viewer()
returns auditlog.context
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;
  if c.staff_id is null then
    raise exception 'Sign in with your PIN to view the log' using errcode = 'insufficient_privilege';
  end if;
  -- A GET runs in a read-only transaction, where "log viewed" could not be
  -- written. Looking must leave a trace, so reading that way is refused.
  if current_setting('transaction_read_only', true) = 'on' then
    raise exception 'The log must be requested with POST' using errcode = 'insufficient_privilege';
  end if;
  return c;
end;
$$;

-- p_filter keys (all optional):
--   from, to        timestamptz bounds on when it was recorded
--   staff_id, till_id
--   kinds           ["row","event","auth","guard","system"]
--   tables          ["products", ...]
--   table, pk       history of one record
--   action_prefix   e.g. "cart." or "pin."
--   actors          ["till","member","service","database","anon"]
--   flag            entries carrying this flag, e.g. "outside_the_till"
--   changed         updates that changed this column, e.g. "tab_balance"
--   min_severity    0..3
--   unchecked       true = only alerts nobody has marked as checked
--   q               free text, matched against the whole entry
--   before_seq      paging: entries older than this
--   limit           default 100, max 500
create or replace function public.audit_view(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.require_viewer();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_limit int := least(greatest(coalesce((f ->> 'limit')::int, 100), 1), 500);
  v_kinds text[] := case when jsonb_typeof(f -> 'kinds') = 'array'
                         then array(select jsonb_array_elements_text(f -> 'kinds')) end;
  v_tables text[] := case when jsonb_typeof(f -> 'tables') = 'array'
                          then array(select jsonb_array_elements_text(f -> 'tables')) end;
  v_actors text[] := case when jsonb_typeof(f -> 'actors') = 'array'
                          then array(select jsonb_array_elements_text(f -> 'actors')) end;
  v_q text := nullif(trim(f ->> 'q'), '');
  v_entries jsonb;
  v_last bigint;
begin
  if not exists (select 1 from auditlog.log l
                  where l.action = 'log.viewed' and l.staff_session_id = c.staff_session_id
                    and l.at > now() - interval '5 minutes') then
    perform auditlog.try_write(c, 'system', 'log.viewed', 0, null, null, null, null, null,
      jsonb_build_object('filter', f - 'before_seq' - 'limit'));
  end if;

  select coalesce(jsonb_agg(x.entry order by x.seq desc), '[]'::jsonb), min(x.seq)
    into v_entries, v_last
    from (
      select l.seq, jsonb_build_object(
        'seq', l.seq, 'at', l.at, 'kind', l.kind, 'action', l.action, 'severity', l.severity,
        'table', l.table_name, 'pk', l.row_pk,
        'subject', case l.table_name
                     when 'products' then (select p.name from public.products p where p.id::text = l.row_pk)
                     when 'members' then (select m.name from public.members m where m.id::text = l.row_pk)
                   end,
        'old', l.old_data, 'new', l.new_data, 'changed', to_jsonb(l.changed), 'detail', l.detail,
        'actor', l.actor, 'till_id', l.till_id,
        'staff_id', l.staff_id,
        'staff_name', (select m.name from public.members m where m.id = l.staff_id),
        'staff_trust', l.staff_trust,
        'via', l.via,
        'ip', o.ip, 'app_build', o.app_build,
        'client_at', l.client_at,
        'sealed', l.seal_id is not null,
        'checked', ack.seq is not null,
        'checked_at', ack.at,
        'checked_by', (select m.name from public.members m where m.id = ack.staff_id),
        -- Someone marking an alert about their own action as checked is
        -- allowed (the owner works the bar too) but shown for what it is.
        'checked_by_self', ack.seq is not null and ack.staff_id is not distinct from l.staff_id,
        'check_note', ack.note
      ) as entry
      from auditlog.log l
      left join auditlog.origins o on o.id = l.origin_id
      left join auditlog.acks ack on ack.seq = l.seq
      where (f ->> 'from' is null or l.at >= (f ->> 'from')::timestamptz)
        and (f ->> 'to' is null or l.at < (f ->> 'to')::timestamptz)
        and (f ->> 'staff_id' is null or l.staff_id = (f ->> 'staff_id')::uuid)
        and (f ->> 'till_id' is null or l.till_id = f ->> 'till_id')
        and (v_kinds is null or l.kind = any (v_kinds))
        and (v_tables is null or l.table_name = any (v_tables))
        and (v_actors is null or l.actor = any (v_actors))
        and (f ->> 'flag' is null or coalesce(l.detail -> 'flags' ? (f ->> 'flag'), false))
        and (f ->> 'changed' is null or l.changed @> array[f ->> 'changed'])
        and (f ->> 'table' is null or l.table_name = f ->> 'table')
        and (f ->> 'pk' is null or l.row_pk = f ->> 'pk')
        and (f ->> 'action_prefix' is null or l.action like replace(replace(f ->> 'action_prefix', '%', ''), '_', '\_') || '%')
        and (f ->> 'min_severity' is null or l.severity >= (f ->> 'min_severity')::int)
        and (coalesce((f ->> 'unchecked')::boolean, false) = false
             or (l.severity >= 2 and ack.seq is null))
        and (f ->> 'before_seq' is null or l.seq < (f ->> 'before_seq')::bigint)
        -- Free text also matches the NAMES behind the ids an entry holds
        -- (the product or member it is about, and who did it): searching
        -- "Guinness" has to find the price change to Guinness.
        and (v_q is null or (l.action || ' ' || coalesce(l.table_name, '') || ' ' || coalesce(l.old_data::text, '')
                             || ' ' || coalesce(l.new_data::text, '') || ' ' || coalesce(l.detail::text, '')
                             || ' ' || coalesce(case l.table_name
                                          when 'products' then (select p.name from public.products p where p.id::text = l.row_pk)
                                          when 'members' then (select m.name from public.members m where m.id::text = l.row_pk)
                                        end, '')
                             || ' ' || coalesce((select m.name from public.members m where m.id = l.staff_id), ''))
                            ilike '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%')
      order by l.seq desc
      limit v_limit
    ) x;

  return jsonb_build_object(
    'entries', v_entries,
    'next_before_seq', case when jsonb_array_length(v_entries) = v_limit then v_last end);
end;
$$;

-- Who was signed in, where and when.
create or replace function public.audit_sessions(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.require_viewer();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      -- A stable handle for the page, not the real id (which the event
      -- intake accepts as a reference to a session).
      'id', left(md5(s.id::text), 16), 'staff_id', s.staff_id,
      'staff_name', (select m.name from public.members m where m.id = s.staff_id),
      'till_id', s.till_id, 'trust', s.trust,
      'started_at', s.started_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
      'ip', o.ip) order by s.started_at desc)
      from auditlog.staff_sessions s
      left join auditlog.origins o on o.id = s.origin_id
     where s.started_at < coalesce(p_to, 'infinity'::timestamptz)
       and coalesce(s.ended_at, 'infinity'::timestamptz) >= coalesce(p_from, now() - interval '7 days')
  ), '[]'::jsonb);
end;
$$;

-- The health strip: is everything being recorded, sealed and intact?
create or replace function public.audit_health()
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.require_viewer();
  v_head record;
  v_check record;
begin
  select id, hash, sealed_at into v_head from auditlog.seals order by id desc limit 1;
  select l.action, l.at into v_check from auditlog.log l
   where l.kind = 'system' and l.action in ('integrity.ok', 'integrity.FAILED', 'integrity.checked')
   order by l.seq desc limit 1;

  return jsonb_build_object(
    'entries', (select count(*) from auditlog.log),
    'entries_24h', (select count(*) from auditlog.log where at > now() - interval '24 hours'),
    'last_entry_at', (select max(at) from auditlog.log),
    'unsealed', (select count(*) from auditlog.log where seal_id is null),
    'oldest_unsealed_at', (select min(at) from auditlog.log where seal_id is null),
    'seal', case when v_head.id is null then null else jsonb_build_object(
      'id', v_head.id, 'code', auditlog.seal_code(v_head.id, v_head.hash),
      'hash', encode(v_head.hash, 'hex'), 'sealed_at', v_head.sealed_at) end,
    'last_check', case when v_check.action is null then null else
      jsonb_build_object('result', v_check.action, 'at', v_check.at) end,
    'unchecked_alerts', (select count(*) from auditlog.log l
                          where l.severity >= 2 and not exists (select 1 from auditlog.acks a where a.seq = l.seq)),
    'capture_failures_7d', (select count(*) from auditlog.failures where at > now() - interval '7 days'),
    'coverage', auditlog.coverage(),
    'code_unchanged', auditlog.manifest() is not distinct from (select digest from auditlog.manifests order by id desc limit 1),
    'settings', (select jsonb_build_object('capture_enabled', capture_enabled,
                   'guards_enforced', guards_enforced, 'session_max_hours', session_max_hours)
                   from auditlog.settings),
    'bytes', pg_total_relation_size('auditlog.log'));
end;
$$;

-- Seal whatever is outstanding, then re-verify the whole log, now.
create or replace function public.audit_verify_now()
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.require_viewer();
  v jsonb;
begin
  perform auditlog.seal();
  -- Re-hashing costs about 15 microseconds an entry. Up to ~200,000 entries
  -- (a couple of years) the whole log fits comfortably inside the API's
  -- time limit; beyond that, the chain of every seal is still walked but
  -- only the last 30 days of entries are re-hashed here, and the nightly
  -- job (no time limit) keeps doing the whole thing.
  v := auditlog.verify(case when (select coalesce(sum(row_count), 0) from auditlog.seals) > 200000
                            then now() - interval '30 days' end);
  perform auditlog.try_write(c, 'system',
    case when (v ->> 'ok')::boolean then 'integrity.checked' else 'integrity.FAILED' end,
    case when (v ->> 'ok')::boolean then 0 else 3 end,
    null, null, null, null, null, v);
  return v;
end;
$$;

-- A till remembers the last seal it was shown. Next time, it asks whether
-- the server still has that exact seal. If history has been rewritten in
-- between, the answer is no — and that is recorded as serious.
create or replace function public.audit_seal_witness(p_seal_id bigint default null, p_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
  v_head record;
  v_match boolean := null;
begin
  if c.actor is distinct from 'till' then
    raise exception 'permission denied: till devices only' using errcode = 'insufficient_privilege';
  end if;
  if p_seal_id is not null then
    v_match := exists (select 1 from auditlog.seals s
                        where s.id = p_seal_id and encode(s.hash, 'hex') = lower(coalesce(p_hash, '')));
    if not v_match and not exists (
         select 1 from auditlog.log l
          where l.action = 'integrity.witness_mismatch' and l.auth_uid = c.auth_uid
            and l.at > now() - interval '1 hour') then
      perform auditlog.try_write(c, 'system', 'integrity.witness_mismatch', 3, null, null, null, null, null,
        jsonb_build_object('seal', p_seal_id, 'remembered_hash', left(p_hash, 64),
          'note', 'A till remembered a seal the database no longer has. History may have been rewritten or the database restored.'));
    end if;
  end if;
  select id, hash, sealed_at into v_head from auditlog.seals order by id desc limit 1;
  return jsonb_build_object(
    'match', v_match,
    'head', case when v_head.id is null then null else jsonb_build_object(
      'id', v_head.id, 'code', auditlog.seal_code(v_head.id, v_head.hash),
      'hash', encode(v_head.hash, 'hex'), 'sealed_at', v_head.sealed_at) end);
end;
$$;

-- Mark an alert as looked at.
create or replace function public.audit_ack(p_seq bigint, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.require_viewer();
begin
  if not exists (select 1 from auditlog.log where seq = p_seq) then
    return false;
  end if;
  insert into auditlog.acks (seq, staff_id, note) values (p_seq, c.staff_id, left(p_note, 500))
  on conflict (seq) do nothing;
  if found then
    perform auditlog.try_write(c, 'system', 'alert.checked', 0, null, p_seq::text, null, null, null,
      jsonb_build_object('note', left(p_note, 500)));
  end if;
  return true;
end;
$$;

-- ── 11. Personal-data erasure ────────────────────────────────────────────

-- An append-only log that holds members' names, phone numbers and emails
-- has to have a lawful way to honour an erasure request. This blanks the
-- personal fields in the log entries about one member, keeps every hash
-- (so the seals stay valid and the fact that entries existed is preserved)
-- and records that it was done. Owner only: it is not reachable from the
-- app or the API — run it from the SQL editor.
create or replace function auditlog.erase_member_data(p_member_id uuid, p_reason text)
returns bigint
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
declare
  v_n bigint;
  v_rows jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;
  -- Recorded FIRST: verify() reports any erased entry that has no such
  -- record, so an erasure cannot be done quietly.
  perform auditlog.write(auditlog.ctx(), 'system', 'privacy.erased', 2, 'members', p_member_id::text,
    null, null, null, jsonb_build_object('reason', p_reason));

  -- Only entries that actually hold personal fields are touched; the rest
  -- (tab balance changes and the like) stay exactly as sealed.
  perform set_config('auditlog.erasing', 'on', true);
  with done as (
    update auditlog.log l
       set old_data = auditlog.erase_pii(l.old_data),
           new_data = auditlog.erase_pii(l.new_data),
           erased_at = now()
     where l.table_name = 'members' and l.kind in ('row', 'guard')
       and l.row_pk = p_member_id::text and l.erased_at is null
       and (l.old_data is distinct from auditlog.erase_pii(l.old_data)
            or l.new_data is distinct from auditlog.erase_pii(l.new_data))
    returning l.seq
  )
  select count(*) into v_n from done;
  perform set_config('auditlog.erasing', '', true);

  -- An erased entry no longer matches the hash taken when it was written.
  -- So that it can still be checked, what each one says NOW is hashed into
  -- a second entry, which is sealed like any other: changing an erased
  -- entry later breaks the match.
  if v_n > 0 then
    select jsonb_object_agg(l.seq::text, encode(auditlog.content_digest(l), 'hex')) into v_rows
      from auditlog.log l
     where l.table_name = 'members' and l.row_pk = p_member_id::text and l.erased_at is not null;
    perform auditlog.write(auditlog.ctx(), 'system', 'privacy.erased_rows', 1, 'members', p_member_id::text,
      null, null, null, jsonb_build_object('rows', v_rows));
  end if;
  return v_n;
end;
$$;

-- ── 12. Attach, lock down, schedule, record ──────────────────────────────

-- Put the capture triggers on every table that lacks them. Tables already
-- covered are left completely alone (no lock is taken on them), so this is
-- safe to run at any time and from any later migration. Returns how many
-- tables it attached to.
--
-- A table that is busy (a lock wait or a deadlock) is NOT skipped: that
-- error is let out, so whatever called this fails as a whole and can be run
-- again. Skipping would leave a table quietly unrecorded.
create or replace function auditlog.attach_all()
returns int
language plpgsql
security definer
set search_path = auditlog, public
as $$
declare
  t record;
  v_pk text;
  v_n int := 0;
begin
  for t in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    if exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_capture')
       and exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_truncate')
       and (t.relname not in ('order_items', 'stock_movements')
            or exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_capture_insert'))
    then
      continue;
    end if;

    begin
      -- Single-column primary key, else 'id'. Sale lines are filed under
      -- their order.
      select a.attname into v_pk
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = t.oid and i.indisprimary and i.indnatts = 1;
      v_pk := case when t.relname = 'order_items' then 'order_id' else coalesce(v_pk, 'id') end;

      -- Only drop what is there: DROP TRIGGER IF EXISTS takes the strongest
      -- lock on the table even when there is nothing to drop.
      if exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_capture') then
        execute format('drop trigger zz_audit_capture on public.%I', t.relname);
      end if;
      if exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_capture_insert') then
        execute format('drop trigger zz_audit_capture_insert on public.%I', t.relname);
      end if;
      if exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'zz_audit_truncate') then
        execute format('drop trigger zz_audit_truncate on public.%I', t.relname);
      end if;

      if t.relname in ('order_items', 'stock_movements') then
        execute format('create trigger zz_audit_capture after update or delete on public.%I
                        for each row execute function auditlog.capture_row(%L)', t.relname, v_pk);
        execute format('create trigger zz_audit_capture_insert after insert on public.%I
                        referencing new table as new_rows
                        for each statement execute function auditlog.capture_insert_bulk()', t.relname);
      else
        execute format('create trigger zz_audit_capture after insert or update or delete on public.%I
                        for each row execute function auditlog.capture_row(%L)', t.relname, v_pk);
      end if;
      execute format('create trigger zz_audit_truncate after truncate on public.%I
                      for each statement execute function auditlog.capture_truncate()', t.relname);
      v_n := v_n + 1;
    exception
      when deadlock_detected or lock_not_available or query_canceled then
        raise;
      when others then
        insert into auditlog.failures (source, error, table_name) values ('attach_all', sqlerrm, t.relname);
    end;
  end loop;
  return v_n;
end;
$$;

-- Take every lock this install needs BEFORE changing anything, or none.
--
-- Creating a trigger locks its table against writes. Taking those locks one
-- table at a time while tills are trading can deadlock with a sale (which
-- writes orders, then lines, then stock, then the member) — and whichever
-- side loses, something breaks. So: try to lock all the tables at once
-- without waiting; if any is busy, let go of everything, pause, try again.
-- A sale only ever sees this as a wait of a fraction of a second, never as
-- an error. If the tills stay busy for 20 seconds the migration fails
-- cleanly, having changed nothing, and can be run again.
do $$
declare
  v_tables text;
  v_try int := 0;
begin
  select string_agg(format('public.%I', c.relname), ', ' order by c.relname) into v_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';
  if v_tables is null then return; end if;
  loop
    v_try := v_try + 1;
    begin
      execute 'lock table ' || v_tables || ' in share row exclusive mode nowait';
      exit;
    exception when lock_not_available then
      if v_try >= 100 then
        raise exception 'audit install: the tills are busy; nothing was changed — run the migration again';
      end if;
      perform pg_sleep(0.2);
    end;
  end loop;
end $$;

select auditlog.attach_all();

do $$
declare
  r record;
begin
  for r in select * from auditlog.guard_rules() loop
    if to_regclass('public.' || r.table_name) is not null then
      if exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.' || r.table_name) and g.tgname = 'aa_audit_guard') then
        execute format('drop trigger aa_audit_guard on public.%I', r.table_name);
      end if;
      execute format('create trigger aa_audit_guard before %s on public.%I
                      for each row execute function auditlog.guard_ledger(%L, %L)',
                     case r.mode when 'immutable' then 'update or delete' else 'delete' end,
                     r.table_name, r.mode, r.pk);
    end if;
  end loop;

  if to_regclass('public.members') is not null then
    if exists (select 1 from pg_trigger g where g.tgrelid = 'public.members'::regclass and g.tgname = 'aa_audit_guard_fields') then
      drop trigger aa_audit_guard_fields on public.members;
    end if;
    create trigger aa_audit_guard_fields
      before insert or update of pin_hash, tab_balance, auth_user_id, last_settled_at on public.members
      for each row execute function auditlog.guard_member_fields();
  end if;
end $$;

-- The price change log (20261122120000), reworked:
--
--   * Its staff member now comes from the PIN session on the request when
--     there is one (server-verified), and only falls back to the id the
--     till passed in products.changed_by.
--   * A product's opening row is written AFTER the insert. The original
--     trigger wrote it BEFORE, which fires even when the insert then does
--     nothing (INSERT ... ON CONFLICT DO NOTHING on an existing id): a till
--     could add made-up rows to the price log, naming any staff member,
--     without changing a product at all.
--   * A failure here never blocks the product save.
create or replace function log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_till_id text;
  v_staff uuid;
begin
  if TG_OP = 'INSERT' then
    -- Hand the pass-through to the AFTER INSERT trigger below (or, for an
    -- upsert that turns into an update, to the UPDATE branch), keyed by
    -- product so a multi-row insert keeps each row's own value.
    begin
      perform set_config('auditlog.price_changed_by',
        (coalesce(nullif(current_setting('auditlog.price_changed_by', true), ''), '{}')::jsonb
           || jsonb_build_object(NEW.id::text, NEW.changed_by))::text, true);
    exception when others then null;
    end;
  elsif NEW.standard_price is distinct from OLD.standard_price
     or NEW.member_price is distinct from OLD.member_price
  then
    begin
      select till_id into v_till_id from till_devices where auth_user_id = auth.uid();
      begin
        v_staff := (auditlog.ctx()).staff_id;
      exception when others then
        v_staff := null;
      end;

      insert into product_price_changes (
        product_id, old_standard_price, new_standard_price, old_member_price, new_member_price, staff_id, till_id)
      values (
        NEW.id, OLD.standard_price, NEW.standard_price, OLD.member_price, NEW.member_price,
        coalesce(v_staff, (select m.id from members m
                            where m.id = coalesce(NEW.changed_by,
                              (nullif(current_setting('auditlog.price_changed_by', true), '')::jsonb ->> NEW.id::text)::uuid))),
        v_till_id);
    exception when others then
      begin
        insert into auditlog.failures (source, error, table_name, op)
        values ('log_product_price_change', sqlerrm, 'products', TG_OP);
      exception when others then null;
      end;
    end;
  end if;

  NEW.changed_by := null;
  return NEW;
end;
$$;

create or replace function log_product_price_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_till_id text;
  v_staff uuid;
  v_claim uuid;
begin
  begin
    select till_id into v_till_id from till_devices where auth_user_id = auth.uid();
    begin
      v_staff := (auditlog.ctx()).staff_id;
    exception when others then
      v_staff := null;
    end;
    begin
      v_claim := (nullif(current_setting('auditlog.price_changed_by', true), '')::jsonb ->> NEW.id::text)::uuid;
    exception when others then
      v_claim := null;
    end;

    insert into product_price_changes (product_id, new_standard_price, new_member_price, staff_id, till_id)
    values (NEW.id, NEW.standard_price, NEW.member_price,
            coalesce(v_staff, (select m.id from members m where m.id = v_claim)),
            v_till_id);
  exception when others then
    begin
      insert into auditlog.failures (source, error, table_name, op)
      values ('log_product_price_opening', sqlerrm, 'products', TG_OP);
    exception when others then null;
    end;
  end;
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.products'::regclass and g.tgname = 'products_log_price_opening') then
    create trigger products_log_price_opening
      after insert on products
      for each row execute function log_product_price_opening();
  end if;
end $$;

revoke execute on function log_product_price_opening() from public, anon, authenticated;

-- An install with a hole in it must not be recorded as applied.
do $$
declare
  cov jsonb := auditlog.coverage();
begin
  if jsonb_array_length(cov -> 'missing') > 0 or jsonb_array_length(cov -> 'disabled') > 0
     or jsonb_array_length(cov -> 'repointed') > 0 then
    raise exception 'audit install incomplete (nothing was changed; run the migration again): %', cov;
  end if;
end $$;
revoke execute on function log_product_price_change() from public, anon, authenticated;

-- Nothing in schema auditlog is callable from the API (the schema is not
-- exposed and has no grants); these revokes are belt and braces.
revoke all on all tables in schema auditlog from public, anon, authenticated, service_role;
revoke all on all functions in schema auditlog from public, anon, authenticated, service_role;
revoke all on all sequences in schema auditlog from public, anon, authenticated, service_role;

-- The doors. Tills only (each function also checks that itself).
revoke execute on function public.staff_sign_in(uuid, text) from public, anon;
revoke execute on function public.staff_verify_pin(uuid, text, text) from public, anon;
revoke execute on function public.staff_session_claim(uuid) from public, anon;
revoke execute on function public.staff_sign_out(text, text) from public, anon;
revoke execute on function public.staff_set_pin(uuid, text, text) from public, anon;
revoke execute on function public.audit_log_events(jsonb) from public, anon;
revoke execute on function public.audit_ping() from public, anon;
revoke execute on function public.audit_view(jsonb) from public, anon;
revoke execute on function public.audit_sessions(timestamptz, timestamptz) from public, anon;
revoke execute on function public.audit_health() from public, anon;
revoke execute on function public.audit_verify_now() from public, anon;
revoke execute on function public.audit_seal_witness(bigint, text) from public, anon;
revoke execute on function public.audit_ack(bigint, text) from public, anon;
grant execute on function public.staff_sign_in(uuid, text) to authenticated;
grant execute on function public.staff_verify_pin(uuid, text, text) to authenticated;
grant execute on function public.staff_session_claim(uuid) to authenticated;
grant execute on function public.staff_sign_out(text, text) to authenticated;
grant execute on function public.staff_set_pin(uuid, text, text) to authenticated;
grant execute on function public.audit_log_events(jsonb) to authenticated;
grant execute on function public.audit_ping() to authenticated;
grant execute on function public.audit_view(jsonb) to authenticated;
grant execute on function public.audit_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.audit_health() to authenticated;
grant execute on function public.audit_verify_now() to authenticated;
grant execute on function public.audit_seal_witness(bigint, text) to authenticated;
grant execute on function public.audit_ack(bigint, text) to authenticated;

-- Changing the audit settings is itself an audited event.
create or replace function auditlog.settings_changed()
returns trigger
language plpgsql
security definer
set search_path = auditlog, public, extensions
as $$
begin
  begin
    perform auditlog.try_write(auditlog.ctx(), 'system', 'settings.changed', 3, null, null,
      to_jsonb(OLD), to_jsonb(NEW), null,
      jsonb_build_object('note', 'The audit log''s own settings were changed.'));
  exception when others then null;
  end;
  return NEW;
end;
$$;

drop trigger if exists settings_changed on auditlog.settings;
create trigger settings_changed after update on auditlog.settings
  for each row execute function auditlog.settings_changed();

-- The one settings row is changed, never removed or replaced: deleting it
-- and inserting a new one (with capture off) would otherwise slip past the
-- "settings changed" record above.
create or replace function auditlog.settings_fixed()
returns trigger
language plpgsql
set search_path = auditlog, public
as $$
begin
  raise exception 'auditlog.settings has one row: update it, do not % it', lower(TG_OP)
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists settings_fixed on auditlog.settings;
create trigger settings_fixed before delete on auditlog.settings
  for each row execute function auditlog.settings_fixed();
drop trigger if exists settings_fixed_truncate on auditlog.settings;
create trigger settings_fixed_truncate before truncate on auditlog.settings
  for each statement execute function auditlog.settings_fixed();

-- Schedules. Guarded: if pg_cron is unavailable the migration still
-- applies, sealing then happens whenever someone opens the log's integrity
-- check, and the gap is visible in the health strip.
do $$
begin
  perform cron.schedule('audit-seal', '*/5 * * * *', 'select auditlog.seal_job()');
  perform cron.schedule('audit-nightly', '17 5 * * *', 'select auditlog.nightly()');
exception when others then
  insert into auditlog.failures (source, error) values ('schedule', sqlerrm);
end $$;

-- First entry: the state of the books at the moment recording began.
do $$
declare
  c auditlog.context;
  v_counts jsonb := '{}'::jsonb;
  t record;
  v_n bigint;
begin
  perform set_config('auditlog.via', 'migration:20261123120000_audit_log', true);
  c := auditlog.ctx();
  for t in select c2.relname from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
            where n.nspname = 'public' and c2.relkind = 'r' order by 1 loop
    execute format('select count(*) from public.%I', t.relname) into v_n;
    v_counts := v_counts || jsonb_build_object(t.relname, v_n);
  end loop;
  -- Re-running this file must not re-announce the install or re-accept
  -- code that has not changed.
  if auditlog.manifest() is distinct from (select digest from auditlog.manifests order by id desc limit 1) then
    perform auditlog.accept_manifest('installed by migration 20261123120000_audit_log');
  end if;
  if not exists (select 1 from auditlog.log where action = 'audit.installed') then
    perform auditlog.try_write(c, 'system', 'audit.installed', 1, null, null, null, null, null,
      jsonb_build_object('rows_at_install', v_counts, 'coverage', auditlog.coverage(),
        'note', 'Recording starts here. Nothing before this entry was captured.'));
  end if;
  perform auditlog.seal();
end $$;
