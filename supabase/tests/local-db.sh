#!/usr/bin/env bash
# Throwaway local Postgres that looks enough like Supabase to run every
# migration in supabase/migrations and then the SQL tests in this folder.
#
#   supabase/tests/local-db.sh up        start a fresh cluster + apply all migrations
#   supabase/tests/local-db.sh test      run supabase/tests/*.test.sql against it
#   supabase/tests/local-db.sh psql ...  open psql (extra args passed through)
#   supabase/tests/local-db.sh down      stop and delete the cluster
#
# NEVER points at production: it only ever talks to its own unix socket.
#
# What is stubbed (Supabase provides these; plain Postgres does not):
#   - roles anon / authenticated / service_role (service_role bypasses RLS)
#   - auth.users, auth.uid(), auth.role(), auth.jwt() reading the same
#     request.jwt.claims GUC PostgREST sets, so a test can become a till with
#       set local role authenticated;
#       set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
#   - Supabase's default privileges on schema public
#   - pg_net (net.http_post), pg_cron (cron.schedule/unschedule) and
#     vault.decrypted_secrets as inert stand-ins; "create extension pg_net /
#     pg_cron" lines are skipped when applying migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDIR="${LOCAL_PG_DIR:-/tmp/dionysus-local-pg}"
PORT="${LOCAL_PG_PORT:-54329}"
DB=dionysus_test

PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do
    [ -x "$d/initdb" ] && PGBIN="$d"
  done
fi
[ -n "$PGBIN" ] || { echo "Postgres server binaries not found; set PGBIN" >&2; exit 1; }

# Postgres refuses to run as root; fall back to the postgres OS user.
as_pg() {
  if [ "$(id -u)" = "0" ]; then
    id postgres >/dev/null 2>&1 || useradd -m postgres
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

PSQL=(psql -X -h "$PGDIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1)

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    "$0" down >/dev/null 2>&1 || true
    mkdir -p "$PGDIR"
    if [ "$(id -u)" = "0" ]; then chown postgres "$PGDIR"; chmod 755 "$PGDIR"; fi
    as_pg "$PGBIN/initdb -D $PGDIR/data -U postgres -A trust >/dev/null"
    as_pg "$PGBIN/pg_ctl -D $PGDIR/data -o '-p $PORT -k $PGDIR -c listen_addresses=' -l $PGDIR/log -w start >/dev/null"
    "${PSQL[@]}" -q -d postgres -c "create database $DB"
    "${PSQL[@]}" -q -d "$DB" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- pg_net stand-in: records calls instead of making them.
create schema net;
create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.calls (url, headers, body) values (url, headers, body) returning id
$$;

-- pg_cron stand-in: schedule by name replaces, like the real one.
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d)
$$;

create schema vault;
create table vault.secrets (name text primary key, decrypted_secret text);
create view vault.decrypted_secrets as select * from vault.secrets;

-- Supabase's default privileges: API roles get table/function access and
-- RLS + explicit revokes do the real gating.
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter database dionysus_test set search_path = public, extensions;
SQL
    fail=0
    for f in "$ROOT"/supabase/migrations/*.sql; do
      if ! grep -viE '^\s*create extension if not exists (pg_net|pg_cron)' "$f" \
           | "${PSQL[@]}" -q -d "$DB" -f - >"$PGDIR/last.out" 2>&1; then
        echo "MIGRATION FAILED: $(basename "$f")"; cat "$PGDIR/last.out"; fail=1; break
      fi
    done
    [ "$fail" = 0 ] && echo "local db up: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations applied"
    exit $fail
    ;;
  test)
    fail=0
    shopt -s nullglob
    for t in "$ROOT"/supabase/tests/*.test.sql; do
      if "${PSQL[@]}" -q -d "$DB" -f "$t" >"$PGDIR/last.out" 2>&1; then
        echo "PASS $(basename "$t")"
      else
        echo "FAIL $(basename "$t")"; cat "$PGDIR/last.out"; fail=1
      fi
    done
    exit $fail
    ;;
  psql)
    exec "${PSQL[@]}" -d "$DB" "$@"
    ;;
  down)
    [ -d "$PGDIR/data" ] && as_pg "$PGBIN/pg_ctl -D $PGDIR/data -m immediate stop >/dev/null 2>&1" || true
    rm -rf "$PGDIR"
    ;;
  *)
    sed -n '2,9p' "$0"; exit 2
    ;;
esac
