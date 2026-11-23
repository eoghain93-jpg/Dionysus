-- Tests for 20261123120000_audit_log.sql.
--
-- Run with: supabase/tests/local-db.sh up && supabase/tests/local-db.sh test
--
-- Each "request" below is one transaction, like a PostgREST request: t.req()
-- sets the role, JWT claims, headers, method and path exactly as PostgREST
-- would, the statements run, the transaction commits. Assertions then run
-- as the superuser, reading the audit schema directly.
--
-- The first failed assertion aborts the file with its message.

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
set client_min_messages = warning;

drop schema if exists t cascade;
create schema t;
grant usage on schema t to anon, authenticated, service_role;
create table t.vars (k text primary key, v jsonb);
grant all on t.vars to anon, authenticated, service_role;

create function t.put(k text, v jsonb) returns void language sql as
$$ insert into t.vars values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.get(k text) returns jsonb language sql as
$$ select v from t.vars where k = $1 $$;
create function t.ok(cond boolean, msg text) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- Latest log entry matching kind/action (and optionally table), as jsonb.
create function t.entry(p_kind text, p_action text, p_table text default null) returns jsonb language sql as $$
  select to_jsonb(l) from auditlog.log l
   where l.kind = p_kind and l.action = p_action and (p_table is null or l.table_name = p_table)
   order by l.seq desc limit 1
$$;
create function t.has_flag(e jsonb, f text) returns boolean language sql as
$$ select coalesce(e -> 'detail' -> 'flags' ? f, false) $$;
create function t.n(p_kind text default null, p_action text default null, p_table text default null) returns bigint language sql as $$
  select count(*) from auditlog.log l
   where (p_kind is null or l.kind = p_kind) and (p_action is null or l.action = p_action)
     and (p_table is null or l.table_name = p_table)
$$;

create function t.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

-- Become a caller for the rest of this transaction, the way PostgREST does.
create function t.req(p_who text, p_method text, p_path text, p_token text default null, p_headers jsonb default '{}')
returns void language plpgsql as $$
declare
  v_uid text := case p_who
    when 'till1' then '8c2c1870-5625-44db-b4d3-4352651340dc'
    when 'till2' then '37e48d38-694b-4e84-81c0-d37963a2e1e6'
    when 'member' then 'a0000000-0000-0000-0000-0000000000aa' end;
  v_role text := case p_who when 'service' then 'service_role' when 'anon' then 'anon' else 'authenticated' end;
  h jsonb := jsonb_build_object(
    'user-agent', 'TestBrowser/1.0',
    'cf-connecting-ip', case p_who when 'till2' then '203.0.113.20' else '203.0.113.10' end,
    'x-app-build', 'test123') || p_headers;
begin
  if p_token is not null then h := h || jsonb_build_object('x-staff-session', p_token); end if;
  perform set_config('request.jwt.claims',
    (jsonb_build_object('role', v_role) || case when v_uid is null then '{}'::jsonb else jsonb_build_object('sub', v_uid) end)::text, true);
  perform set_config('request.headers', h::text, true);
  perform set_config('request.method', p_method, true);
  perform set_config('request.path', p_path, true);
  perform set_config('role', v_role, true);
end $$;

\set till1 '8c2c1870-5625-44db-b4d3-4352651340dc'
\set till2 '37e48d38-694b-4e84-81c0-d37963a2e1e6'
\set sam '5a000000-0000-0000-0000-000000000001'
\set kim '5a000000-0000-0000-0000-000000000002'
\set mo 'a0000000-0000-0000-0000-000000000003'
\set guinness 'b0000000-0000-0000-0000-000000000001'
\set crisps 'b0000000-0000-0000-0000-000000000002'
-- bcryptjs.hashSync('4821', 10) — the exact library and cost the till uses.
\set sam_hash '$2b$10$TwRUUCA9qRhAKjfmNAT9e.GefI3l2JMtvNZqf1/yOP5FOD75SHc8S'

-- ── Setup (direct SQL, like a migration or the dashboard) ────────────────

insert into auth.users (id) values (:'till1'), (:'till2'), ('a0000000-0000-0000-0000-0000000000aa');
insert into till_devices (auth_user_id, till_id, name) values (:'till1', 'till-1', 'Main'), (:'till2', 'till-2', 'Second');
insert into members (id, name, membership_number, membership_tier, pin_hash, email)
values (:'sam', 'Sam Staff', 'S001', 'staff', :'sam_hash', 'sam@example.test'),
       (:'kim', 'Kim Newstarter', 'S002', 'staff', null, null);
insert into members (id, name, membership_number, membership_tier, auth_user_id, phone, email)
values (:'mo', 'Mo Member', 'M001', 'member', 'a0000000-0000-0000-0000-0000000000aa', '07700 900123', 'mo@example.test');
insert into products (id, name, category, standard_price, member_price, stock_quantity)
values (:'guinness', 'Guinness', 'draught', 7.40, 6.40, 100),
       (:'crisps', 'Crisps', 'food', 1.00, 1.00, 50);

select t.ok((select count(*) from auditlog.failures) = 0, 'no capture failures after setup');
select t.ok((t.entry('row', 'insert', 'members') ->> 'actor') = 'database', 'direct SQL is recorded as actor=database');
select t.ok((t.entry('row', 'insert', 'members') ->> 'severity')::int = 2, 'direct SQL writes are alerts');
select t.ok(t.has_flag(t.entry('row', 'insert', 'members'), 'outside_the_till'), 'direct SQL flagged outside_the_till');
select t.ok((t.entry('row', 'insert', 'till_devices') ->> 'severity')::int = 3, 'till registration change is serious');
select t.ok((t.entry('row', 'insert', 'till_devices') ->> 'row_pk') = :'till2', 'non-id primary key captured as row_pk');

-- ── Secrets never reach the log ──────────────────────────────────────────

select t.ok(not exists (select 1 from auditlog.log l where to_jsonb(l)::text like '%TwRUUCA9qRhAKjf%'),
  'a PIN hash never appears anywhere in the log');
select t.ok(exists (select 1 from auditlog.log l where l.table_name = 'members' and l.row_pk = :'sam'
                      and l.new_data ->> 'pin_hash' = '[redacted]'), 'pin_hash is stored as [redacted]');
select t.ok(exists (select 1 from auditlog.log l where l.table_name = 'members' and l.row_pk = :'kim'
                      and l.new_data -> 'pin_hash' = 'null'::jsonb), 'an empty pin_hash stays visibly empty');

-- ── A till with nobody signed in ─────────────────────────────────────────

begin;
select t.req('till1', 'POST', '/stock_movements');
insert into stock_movements (product_id, type, quantity, till_id, notes) values (:'guinness', 'wastage', 1, 'till-1', 'line clean');
commit;

select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'actor') = 'till', 'till write: actor=till');
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'till_id') = 'till-1', 'till id comes from the device');
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'staff_trust') = 'none', 'nobody signed in: staff_trust=none');
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'via') = 'POST /stock_movements', 'via = method + path');
select t.ok((select o.ip from auditlog.origins o where o.id = (t.entry('row', 'insert', 'stock_movements') ->> 'origin_id')::bigint) = '203.0.113.10',
  'origin network address recorded');
select t.ok((t.entry('row', 'insert', 'stock_movements') -> 'new_data' -> 0 ->> 'type') = 'wastage'
            and (t.entry('row', 'insert', 'stock_movements') ->> 'severity')::int = 1
            and (t.entry('row', 'insert', 'stock_movements') ->> 'row_pk') is not null, 'wastage is notable and filed under its own id');
select t.ok(t.n('system', 'device.new_address') = 1, 'first sighting of a till on an address raises one alert');
select t.ok((select stock_quantity from products where id = :'guinness') = 99, 'wastage decremented stock');
select t.ok(not exists (select 1 from auditlog.log where table_name = 'products' and action = 'update'),
  'derived stock decrement is not logged as a product edit');

begin;
select t.req('till1', 'POST', '/stock_movements');
insert into stock_movements (product_id, type, quantity, till_id) values (:'guinness', 'wastage', 1, 'till-1');
commit;
select t.ok(t.n('system', 'device.new_address') = 1, 'same address again: no second alert');

-- ── Staff sign-in, in the database ───────────────────────────────────────

begin;
select t.req('till1', 'POST', '/rpc/staff_sign_in');
select t.put('bad', staff_sign_in(:'sam', '0000'));
commit;
select t.ok((t.get('bad') ->> 'valid')::boolean = false, 'wrong PIN rejected');
select t.ok((t.get('bad') ->> 'attemptsRemaining')::int = 4, 'wrong PIN reports attempts remaining');
select t.ok(not (t.get('bad') ? 'outcome') and not (t.get('bad') ? 'name'), 'internal fields are not returned to the till');
select t.ok((t.entry('auth', 'pin.wrong_pin') ->> 'row_pk') = :'sam', 'wrong PIN logged against the person tried');
select t.ok((select failed_count from pin_attempts where member_id = :'sam') = 1, 'failed attempt counted');

begin;
select t.req('till1', 'POST', '/rpc/staff_sign_in');
select t.put('sam', staff_sign_in(:'sam', '4821'));
commit;
select t.ok((t.get('sam') ->> 'valid')::boolean, 'a real bcryptjs $2b$ hash verifies in the database');
select t.ok((t.get('sam') -> 'member' ->> 'name') = 'Sam Staff', 'sign-in returns the member');
select t.ok(length(t.get('sam') -> 'session' ->> 'token') = 64, 'sign-in returns a session token');
select t.ok(not exists (select 1 from pin_attempts where member_id = :'sam'), 'success clears the failed count');
select t.ok((t.entry('auth', 'staff.sign_in') ->> 'staff_trust') = 'pin', 'sign-in logged as PIN-verified');
select t.ok((t.entry('auth', 'staff.sign_in') ->> 'staff_id') = :'sam', 'sign-in logged against Sam');
select t.ok(not exists (select 1 from auditlog.log l where to_jsonb(l)::text like '%' || (t.get('sam') -> 'session' ->> 'token') || '%')
            and not exists (select 1 from auditlog.staff_sessions s where encode(s.token_hash, 'escape') = (t.get('sam') -> 'session' ->> 'token')),
  'the session token itself is stored nowhere');

select t.get('sam') -> 'session' ->> 'token' as sam_token \gset
select t.get('sam') -> 'session' ->> 'id' as sam_session \gset

-- ── The incident, replayed: a price change with a session ────────────────

begin;
select t.req('till1', 'PATCH', '/products', :'sam_token');
-- Exactly what the old bundle sends: no changed_by, every form field.
update products set name = 'Guinness', category = 'draught', standard_price = 6.40, member_price = 6.40,
       stock_quantity = 98, par_level = 0, unit = 'each', active = true
 where id = :'guinness';
commit;

select t.put('e', t.entry('row', 'update', 'products'));
select t.ok((t.get('e') ->> 'staff_id') = :'sam', 'price change attributed to the PIN session');
select t.ok((t.get('e') ->> 'staff_trust') = 'pin', 'price change trust = pin');
select t.ok((t.get('e') -> 'changed') = '["standard_price"]'::jsonb, 'only the changed column is listed');
select t.ok((t.get('e') -> 'old_data') = '{"standard_price": 7.40}'::jsonb and (t.get('e') -> 'new_data') = '{"standard_price": 6.40}'::jsonb,
  'old and new values of just that column are kept');
select t.ok(t.has_flag(t.get('e'), 'member_discount_removed') and (t.get('e') ->> 'severity')::int = 2,
  'standard price dropped to the member price: alert');
select t.ok((select staff_id from product_price_changes where product_id = :'guinness' and old_standard_price = 7.40) = :'sam',
  'price change log takes its staff member from the session');

begin;
select t.req('till1', 'PATCH', '/products', :'sam_token');
update products set standard_price = 7.40 where id = :'guinness';
commit;
select t.ok(not t.has_flag(t.entry('row', 'update', 'products'), 'member_discount_removed')
            and (t.entry('row', 'update', 'products') ->> 'severity')::int = 1, 'an ordinary price change is notable, not an alert');

begin;
select t.req('till1', 'PATCH', '/products', :'sam_token');
update products set stock_quantity = 500 where id = :'guinness';
commit;
select t.ok(t.has_flag(t.entry('row', 'update', 'products'), 'stock_typed_in'), 'stock typed into the product form IS logged');
update products set stock_quantity = 98 where id = :'guinness';

-- ── A sale ───────────────────────────────────────────────────────────────

begin;
select t.req('till1', 'POST', '/rpc/create_order_with_items', :'sam_token');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000001', 'member_id', :'mo', 'staff_id', :'sam',
    'payment_method', 'tab', 'total_amount', 13.80, 'status', 'paid', 'till_id', 'till-1', 'created_at', now()),
  jsonb_build_array(
    jsonb_build_object('product_id', :'guinness', 'quantity', 2, 'unit_price', 6.40, 'member_price_applied', true),
    jsonb_build_object('product_id', :'crisps', 'quantity', 1, 'unit_price', 0.50, 'member_price_applied', false)));
commit;

select t.put('o', t.entry('row', 'insert', 'orders'));
select t.ok((t.get('o') ->> 'via') = 'POST /rpc/create_order_with_items', 'sale via the order function');
select t.ok((t.get('o') -> 'detail' ->> 'rung_by_trust') = 'pin', 'sale: who rang it is PIN-verified');
select t.ok((t.get('o') ->> 'severity')::int = 0, 'an ordinary sale is routine');
select t.put('li', t.entry('row', 'insert', 'order_items'));
select t.ok(t.n('row', 'insert', 'order_items') = 1 and jsonb_array_length(t.get('li') -> 'new_data') = 2
            and (t.get('li') ->> 'row_pk') = 'c0000000-0000-0000-0000-000000000001',
  'the lines of a sale are one entry, filed under the order');
select t.ok(not (t.get('li') -> 'new_data' -> 0 ? 'order_id') and (t.get('li') -> 'new_data' -> 0 ? 'unit_price'), 'line images keep the price, drop the repeated order id');
select t.ok(exists (select 1 from jsonb_each(t.get('li') -> 'detail' -> 'lines') x
                     where x.value ->> 'product' = 'Guinness' and (x.value ->> 'list_standard')::numeric = 7.40
                       and (x.value ->> 'list_member')::numeric = 6.40 and not (x.value ? 'below_list_price')),
  'list prices frozen next to the price charged');
select t.ok(exists (select 1 from jsonb_each(t.get('li') -> 'detail' -> 'lines') x
                     where x.value ->> 'product' = 'Crisps' and (x.value ->> 'below_list_price')::boolean)
            and t.has_flag(t.get('li'), 'below_list_price'), 'a line sold under list price is flagged');
select t.ok(not exists (select 1 from auditlog.log l where l.table_name = 'stock_movements' and l.via like '%create_order_with_items'),
  'sale stock movements derived from the lines are not logged a second time');
select t.ok((select count(*) from stock_movements where type = 'sale') = 2, '(the movements themselves exist)');
select t.ok((select tab_balance from members where id = :'mo') = 13.80, 'tab balance moved');
select t.put('m', t.entry('row', 'update', 'members'));
select t.ok((t.get('m') -> 'changed') = '["tab_balance"]'::jsonb and (t.get('m') ->> 'severity')::int = 0,
  'tab balance change by the order function is routine (not a direct edit)');
select t.ok((select stock_quantity from products where id = :'guinness') = 96, 'sale decremented stock once');

-- Replayed sync of the same order: a no-op, and nothing new is logged.
select t.n() as before \gset
begin;
select t.req('till1', 'POST', '/rpc/create_order_with_items', :'sam_token');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000001', 'payment_method', 'tab', 'total_amount', 13.80),
  '[]'::jsonb);
commit;
select t.ok(t.n() = :before, 'replayed order writes nothing');

-- An offline sale synced three hours later, claiming a different person.
begin;
select t.req('till1', 'POST', '/rpc/create_order_with_items', :'sam_token');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000002', 'staff_id', :'kim', 'payment_method', 'cash',
    'total_amount', 7.40, 'till_id', 'till-2', 'created_at', now() - interval '3 hours'),
  jsonb_build_array(jsonb_build_object('product_id', :'guinness', 'quantity', 1, 'unit_price', 7.40)));
commit;
select t.put('o', t.entry('row', 'insert', 'orders'));
select t.ok(t.has_flag(t.get('o'), 'arrived_late') and (t.get('o') -> 'detail' ->> 'late_by_seconds')::int > 10000, 'late arrival flagged with the delay');
select t.ok(t.has_flag(t.get('o'), 'till_claim_mismatch'), 'till id claimed differs from the device: flagged');
select t.ok(t.has_flag(t.get('o'), 'staff_unverified') and (t.get('o') -> 'detail' ->> 'rung_by_trust') = 'claimed',
  'a claimed staff id with no matching session is labelled a claim');
select t.ok((t.get('o') ->> 'staff_id') = :'sam', 'the request itself is still attributed to the signed-in session');

-- Old bundle: no staff at all.
begin;
select t.req('till1', 'POST', '/rpc/create_order_with_items');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000003', 'payment_method', 'card', 'total_amount', 1.00),
  jsonb_build_array(jsonb_build_object('product_id', :'crisps', 'quantity', 1, 'unit_price', 1.00)));
commit;
select t.ok(t.has_flag(t.entry('row', 'insert', 'orders'), 'no_staff_on_sale'), 'a sale with no staff is flagged, not refused');

-- ── Everything the shipped bundle does still works, unchanged ────────────

begin;
select t.req('till1', 'POST', '/rpc/settle_tab');
select t.put('settle', to_jsonb(settle_tab(p_member_id => :'mo', p_amount => 3.80, p_payment_method => 'cash', p_till_id => 'till-1')));
commit;
select t.ok((t.get('settle'))::numeric = 10.00, 'old 4-argument settle_tab call still works');

begin;
select t.req('till1', 'POST', '/rpc/adjust_tab_balance');
select adjust_tab_balance(:'mo', 1.00);
commit;
select t.ok((select tab_balance from members where id = :'mo') = 11.00, 'adjust_tab_balance works');
select t.ok(not t.has_flag(t.entry('row', 'update', 'members'), 'direct_edit_of_protected_field'), 'function balance change is not flagged');

begin;
select t.req('till1', 'POST', '/tab_adjustments');
insert into tab_adjustments (member_id, amount, reason, staff_id) values (:'mo', 1.00, 'test', :'sam');
commit;

begin;
select t.req('till1', 'POST', '/rpc/correct_order_payment_method');
select correct_order_payment_method('c0000000-0000-0000-0000-000000000003', 'cash', :'sam');
commit;
select t.ok((select payment_method from orders where id = 'c0000000-0000-0000-0000-000000000003') = 'cash', 'payment correction works');
select t.ok(not t.has_flag(t.entry('row', 'update', 'orders'), 'direct_edit_of_sale'), 'function edit of a sale is not flagged');
select t.ok(t.n('row', 'insert', 'order_corrections') = 1, 'correction audit row recorded');

-- Tab "Remove": restock insert, direct void, cancel banked credits, balance delta.
begin;
select t.req('till1', 'POST', '/stock_movements');
insert into stock_movements (product_id, type, quantity, notes, created_at)
values (:'guinness', 'restock', 2, 'Restored from voided order', now()), (:'crisps', 'restock', 1, 'Restored from voided order', now());
commit;
begin;
select t.req('till1', 'PATCH', '/orders');
update orders set status = 'voided' where id = 'c0000000-0000-0000-0000-000000000001';
commit;
select t.ok((select status from orders where id = 'c0000000-0000-0000-0000-000000000001') = 'voided', 'direct tab void still works');
select t.ok(t.has_flag(t.entry('row', 'update', 'orders'), 'voided') and not t.has_flag(t.entry('row', 'update', 'orders'), 'direct_edit_of_sale'),
  'a void is notable but is not a forbidden edit');
begin;
select t.req('till1', 'PATCH', '/staff_drink_credits');
update staff_drink_credits set status = 'cancelled' where order_id = 'c0000000-0000-0000-0000-000000000001' and status = 'banked';
commit;

begin;
select t.req('till1', 'POST', '/z_reports');
insert into z_reports (report_date, opening_float, actual_cash, closed_at) values (current_date, 300, 512.40, now())
on conflict (report_date) do update set opening_float = excluded.opening_float, actual_cash = excluded.actual_cash, closed_at = excluded.closed_at;
commit;

begin;
select t.req('till1', 'POST', '/promotions');
insert into promotions (id, name, active) values ('d0000000-0000-0000-0000-000000000001', 'Happy hour', true);
insert into promotion_items (promotion_id, product_id, discount_type, discount_value)
values ('d0000000-0000-0000-0000-000000000001', :'guinness', 'fixed_price', 5.00);
commit;
begin;
select t.req('till1', 'DELETE', '/promotion_items');
delete from promotion_items where promotion_id = 'd0000000-0000-0000-0000-000000000001';
commit;
select t.ok(not exists (select 1 from promotion_items), 'promo save can still clear its items');
begin;
select t.req('till1', 'PATCH', '/promotions');
update promotions set active = false where id = 'd0000000-0000-0000-0000-000000000001';
commit;

begin;
select t.req('till1', 'PATCH', '/members');
update members set name = 'Mo Member', phone = '07700 900999', membership_tier = 'member', active = true where id = :'mo';
commit;
select t.ok((t.entry('row', 'update', 'members') -> 'changed') = '["phone"]'::jsonb, 'member edit logs just what changed');

begin;
select t.req('till1', 'POST', '/cashback_transactions');
insert into cashback_transactions (amount, staff_id, till_id) values (20, :'sam', 'till-1');
insert into guest_signins (guest_name, member_id, staff_id, till_id) values ('A Guest', :'mo', :'sam', 'till-1');
commit;

select t.ok((select count(*) from auditlog.failures) = 0, 'no capture failures after replaying the shipped bundle');
select t.ok(not exists (select 1 from auditlog.log where kind = 'guard'), 'nothing the shipped bundle does trips a guard');

-- ── History cannot be rewritten from a till ──────────────────────────────

begin;
select t.req('till1', 'DELETE', '/orders', :'sam_token');
delete from orders where id = 'c0000000-0000-0000-0000-000000000002';
commit;
select t.ok(exists (select 1 from orders where id = 'c0000000-0000-0000-0000-000000000002'), 'a till cannot delete a sale');
select t.put('g', t.entry('guard', 'blocked.delete', 'orders'));
select t.ok((t.get('g') ->> 'severity')::int = 3 and (t.get('g') ->> 'staff_id') = :'sam', 'the attempt is logged, serious, with who');

begin;
select t.req('till1', 'PATCH', '/order_items');
update order_items set unit_price = 0.01 where order_id = 'c0000000-0000-0000-0000-000000000002';
commit;
select t.ok((select unit_price from order_items where order_id = 'c0000000-0000-0000-0000-000000000002') = 7.40, 'a till cannot edit a sale line');
select t.ok((t.entry('guard', 'blocked.update', 'order_items') -> 'new_data' ->> 'unit_price')::numeric = 0.01, 'what was attempted is kept');

begin;
select t.req('till1', 'DELETE', '/stock_movements');
delete from stock_movements;
commit;
select t.ok((select count(*) from stock_movements) > 5, 'a till cannot delete stock movements');

begin;
select t.req('till1', 'DELETE', '/tab_adjustments');
delete from tab_adjustments;
delete from order_corrections;
delete from product_price_changes;
delete from members where id = :'kim';
delete from products where id = :'crisps';
delete from z_reports;
commit;
select t.ok((select count(*) from tab_adjustments) = 1 and (select count(*) from order_corrections) = 1
            and (select count(*) from product_price_changes) >= 3 and exists (select 1 from members where id = :'kim')
            and exists (select 1 from products where id = :'crisps') and (select count(*) from z_reports) = 1,
  'ledgers, members, products and day closes cannot be deleted from a till');
select t.ok(not exists (select 1 from auditlog.log l where l.kind = 'guard' and to_jsonb(l)::text like '%TwRUUCA9qRhAKjf%'),
  'guard entries are redacted too');

-- Editing a sale directly is recorded as serious (observe-only for now).
begin;
select t.req('till1', 'PATCH', '/orders', :'sam_token');
update orders set total_amount = 0.10 where id = 'c0000000-0000-0000-0000-000000000002';
commit;
select t.ok(t.has_flag(t.entry('row', 'update', 'orders'), 'direct_edit_of_sale')
            and (t.entry('row', 'update', 'orders') ->> 'severity')::int = 3, 'direct edit of a sale: serious alert');
begin;
select t.req('till1', 'PATCH', '/members', :'sam_token');
update members set tab_balance = 0 where id = :'mo';
commit;
select t.ok(t.has_flag(t.entry('row', 'update', 'members'), 'direct_edit_of_protected_field')
            and (t.entry('row', 'update', 'members') ->> 'severity')::int = 3, 'direct edit of a tab balance: serious alert');
begin;
select t.req('till1', 'PATCH', '/members', :'sam_token');
update members set membership_tier = 'staff' where id = :'mo';
commit;
select t.ok(t.has_flag(t.entry('row', 'update', 'members'), 'tier_changed')
            and (t.entry('row', 'update', 'members') ->> 'severity')::int = 2, 'promoting someone to staff: alert');
update members set membership_tier = 'member' where id = :'mo';

-- The service key and the SQL editor can still repair data; it is loud.
begin;
select t.req('service', 'DELETE', '/orders');
delete from orders where id = 'c0000000-0000-0000-0000-000000000003';
commit;
select t.ok(not exists (select 1 from orders where id = 'c0000000-0000-0000-0000-000000000003'), 'service key can delete');
select t.ok((t.entry('row', 'delete', 'orders') ->> 'actor') = 'service' and (t.entry('row', 'delete', 'orders') ->> 'severity')::int = 2
            and (t.entry('row', 'delete', 'orders') -> 'old_data' ->> 'total_amount')::numeric = 1.00,
  'a service-key delete is recorded with the full deleted row');
select t.ok(t.n('row', 'delete', 'order_items') >= 1, 'cascaded line deletes are recorded too');
begin;
select t.req('service', 'DELETE', '/products');
delete from promotion_items where product_id = 'b0000000-0000-0000-0000-000000000002';
commit;

-- A direct insert of a 'sale' movement (not through the order function) IS logged.
begin;
select t.req('till1', 'POST', '/stock_movements');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'sale', 1, 'till-1'), (:'crisps', 'restock', 3, 'till-1');
commit;
select t.ok(jsonb_array_length(t.entry('row', 'insert', 'stock_movements') -> 'new_data') = 2
            and (t.entry('row', 'insert', 'stock_movements') -> 'detail' ->> 'rows')::int = 2
            and (t.entry('row', 'insert', 'stock_movements') ->> 'row_pk') is null, 'a multi-row movement insert is one entry with every row');

-- An edge function that names itself is named in the log.
begin;
select t.req('service', 'POST', '/pin_attempts', null, '{"x-audit-actor": "verify-pin"}');
insert into pin_attempts (member_id, failed_count) values (:'kim', 1);
commit;
select t.ok((t.entry('row', 'insert', 'pin_attempts') ->> 'via') = 'fn:verify-pin POST /pin_attempts'
            and (t.entry('row', 'insert', 'pin_attempts') ->> 'actor') = 'service', 'edge functions are named by their x-audit-actor header');
delete from pin_attempts;

-- Guards switched to observe-only: the write goes through, still logged.
update auditlog.settings set guards_enforced = false;
select t.ok((t.entry('system', 'settings.changed') ->> 'severity')::int = 3, 'changing audit settings is itself a serious entry');
begin;
select t.req('till1', 'DELETE', '/tab_adjustments');
delete from tab_adjustments;
commit;
select t.ok((select count(*) from tab_adjustments) = 0 and t.n('guard', 'would_block.delete', 'tab_adjustments') = 1,
  'observe-only: allowed, recorded as would_block');
update auditlog.settings set guards_enforced = true;

-- ── Sessions ─────────────────────────────────────────────────────────────

-- Sam's token on the OTHER till is not a session.
begin;
select t.req('till2', 'POST', '/stock_movements', :'sam_token');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'wastage', 1, 'till-2');
commit;
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'staff_trust') = 'none'
            and (t.entry('row', 'insert', 'stock_movements') ->> 'till_id') = 'till-2', 'a session token only works on the till it was created on');
select t.ok(t.n('system', 'device.new_address') = 2, 'second till on its own address: its own first-sighting alert');

-- Kim has no PIN yet.
begin;
select t.req('till1', 'POST', '/rpc/staff_sign_in');
select t.put('kim0', staff_sign_in(:'kim', '1111'));
commit;
select t.ok((t.get('kim0') ->> 'reason') = 'no_pin', 'no PIN yet: reason=no_pin, same as verify-pin');

begin;
select t.req('till1', 'POST', '/rpc/staff_set_pin', :'sam_token');
select t.put('kimset', staff_set_pin(:'kim', '2468'));
commit;
select t.ok((t.get('kimset') ->> 'success')::boolean, 'first PIN can be set');
select t.put('e', t.entry('auth', 'pin.first_set'));
select t.ok((t.get('e') ->> 'severity')::int = 2 and (t.get('e') ->> 'staff_id') = :'sam' and (t.get('e') ->> 'row_pk') = :'kim'
            and (t.get('e') -> 'detail' ->> 'set_by_self') = 'false', 'a first PIN is an alert, with who was signed in when it was set');
select t.ok(not exists (select 1 from auditlog.log l where to_jsonb(l)::text like '%' || (select pin_hash from members where id = :'kim') || '%'),
  'the new hash is not in the log');
select t.ok((select pin_hash from members where id = :'kim') like '$2a$10$%', 'database writes a bcrypt hash bcryptjs can verify');

begin;
select t.req('till1', 'POST', '/rpc/staff_set_pin', :'sam_token');
select t.put('kimchg0', staff_set_pin(:'kim', '1357'));
select t.put('kimchg1', staff_set_pin(:'kim', '1357', '0000'));
select t.put('kimchg2', staff_set_pin(:'kim', '1357', '2468'));
commit;
select t.ok((t.get('kimchg0') ->> 'error') like 'current_pin required%', 'changing a PIN needs the current one');
select t.ok((t.get('kimchg1') ->> 'error') = 'Incorrect current PIN', 'wrong current PIN refused');
select t.ok((t.get('kimchg2') ->> 'success')::boolean, 'right current PIN accepted');

-- Kim signs in on till 1: Sam's session there is replaced.
begin;
select t.req('till1', 'POST', '/rpc/staff_sign_in', :'sam_token');
select t.put('kim', staff_sign_in(:'kim', '1357'));
commit;
select t.get('kim') -> 'session' ->> 'token' as kim_token \gset
select t.ok((t.get('kim') ->> 'valid')::boolean, 'Kim signs in with the PIN the database hashed');
select t.ok((select end_reason from auditlog.staff_sessions where id = :'sam_session') = 'replaced', 'previous session on that till is ended');
select t.ok((t.entry('auth', 'staff.sign_in') ->> 'staff_id') = :'kim', 'the sign-in entry is the new person, not the old token');

begin;
select t.req('till1', 'POST', '/stock_movements', :'sam_token');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'wastage', 1, 'till-1');
commit;
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'staff_trust') = 'none', 'an ended session no longer attributes anything');

-- Now an offline sale Sam rang earlier is corroborated by the session record.
select (started_at + interval '1 second')::text as sam_time from auditlog.staff_sessions where id = :'sam_session' \gset
begin;
select t.req('till1', 'POST', '/rpc/create_order_with_items', :'kim_token');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000004', 'staff_id', :'sam', 'payment_method', 'cash',
    'total_amount', 7.40, 'till_id', 'till-1',
    'created_at', :'sam_time'::timestamptz),
  jsonb_build_array(jsonb_build_object('product_id', :'guinness', 'quantity', 1, 'unit_price', 7.40)));
commit;
select t.ok((t.entry('row', 'insert', 'orders') -> 'detail' ->> 'rung_by_trust') = 'session_record',
  'a replayed sale is corroborated when its claimed staff member was signed in on that till at that time');

-- PinGate re-check.
begin;
select t.req('till1', 'POST', '/rpc/staff_verify_pin', :'kim_token');
select t.put('gate', staff_verify_pin(:'kim', '1357', 'z_report'));
commit;
select t.ok((t.get('gate') ->> 'valid')::boolean and (t.entry('auth', 'pin.confirmed') -> 'detail' ->> 'purpose') = 'z_report',
  'PIN re-check records what it was for');
select t.ok((select count(*) from auditlog.staff_sessions where ended_at is null and device = :'till1') = 1, 'a re-check opens no new session');

-- Lockout: five wrong PINs, shared rule with verify-pin.
begin;
select t.req('till2', 'POST', '/rpc/staff_sign_in');
select staff_sign_in(:'sam', '0001'); select staff_sign_in(:'sam', '0002'); select staff_sign_in(:'sam', '0003'); select staff_sign_in(:'sam', '0004');
select t.put('lock5', staff_sign_in(:'sam', '0005'));
select t.put('lock6', staff_sign_in(:'sam', '4821'));
commit;
select t.ok((t.get('lock5') ->> 'reason') = 'locked' and (t.get('lock5') ->> 'retryAfterSeconds')::int = 900, 'fifth wrong PIN locks for 15 minutes');
select t.ok((t.get('lock6') ->> 'reason') = 'locked' and (t.get('lock6') ->> 'valid')::boolean = false, 'even the right PIN is refused while locked');
select t.ok((select failed_count from pin_attempts where member_id = :'sam') = 0
            and (select locked_until from pin_attempts where member_id = :'sam') > now() + interval '14 minutes',
  'lock state matches what verify-pin writes (count reset, locked_until set)');
select t.ok((t.entry('auth', 'pin.locked_now') ->> 'severity')::int = 2 and (t.entry('auth', 'pin.locked') ->> 'severity')::int = 2,
  'lockout and attempts while locked are alerts');
delete from pin_attempts;

-- The legacy fallback cannot be used to sign in as someone whose PIN the
-- database can check itself.
begin;
select t.req('till2', 'POST', '/rpc/staff_session_claim');
select t.put('claim0', staff_session_claim(:'sam'));
commit;
select t.ok((t.get('claim0') ->> 'valid')::boolean = false and not (t.get('claim0') ? 'session')
            and (t.entry('auth', 'session.claim_refused') ->> 'severity')::int = 2,
  'claiming a session for a checkable PIN is refused and recorded');

-- With a hash the database cannot read (some future format), the fallback
-- session is allowed and labelled a claim.
update members set pin_hash = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG' where id = :'sam';
begin;
select t.req('till2', 'POST', '/rpc/staff_sign_in');
select t.put('unsupported', to_jsonb(t.refused($$select staff_sign_in('5a000000-0000-0000-0000-000000000001', '4821')$$)));
commit;
select t.ok((t.get('unsupported'))::boolean, 'an unreadable hash makes staff_sign_in raise, so the till falls back');
begin;
select t.req('till2', 'POST', '/rpc/staff_session_claim');
select t.put('claim', staff_session_claim(:'sam'));
commit;
update members set pin_hash = :'sam_hash' where id = :'sam';
select t.get('claim') -> 'session' ->> 'token' as claim_token \gset
begin;
select t.req('till2', 'POST', '/stock_movements', :'claim_token');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'wastage', 1, 'till-2');
commit;
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'staff_trust') = 'claimed'
            and (t.entry('row', 'insert', 'stock_movements') ->> 'staff_id') = :'sam', 'a claimed session attributes, and says it is a claim');
begin;
select t.req('till2', 'POST', '/rpc/staff_session_claim');
do $$ begin
  perform staff_session_claim('a0000000-0000-0000-0000-000000000003');
  raise exception 'ASSERTION FAILED: a non-staff member could claim a session';
exception when others then
  if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
end $$;
commit;

-- Sign out.
begin;
select t.req('till2', 'POST', '/rpc/staff_sign_out', :'claim_token');
select t.put('out', to_jsonb(staff_sign_out('idle_lock')));
commit;

select t.ok((t.get('out'))::boolean and (t.entry('auth', 'staff.sign_out') -> 'detail' ->> 'reason') = 'idle_lock', 'sign-out recorded with its reason');
select t.ok(exists (select 1 from auditlog.staff_sessions where end_reason = 'idle_lock'), 'session ended');

-- Sign-out by explicit token: works with NO session header on the request
-- (the till has already forgotten the token by the time the request goes).
begin;
select t.req('till2', 'POST', '/rpc/staff_sign_in');
select t.put('sam2', staff_sign_in(:'sam', '4821'));
commit;
select t.get('sam2') -> 'session' ->> 'token' as sam2_token \gset
begin;
select t.req('till1', 'POST', '/rpc/staff_sign_out');
select t.put('out_wrong_till', to_jsonb(staff_sign_out('sign_out', :'sam2_token')));
commit;
begin;
select t.req('till2', 'POST', '/rpc/staff_sign_out');
select t.put('out_bad', to_jsonb(staff_sign_out('sign_out', 'not-a-token')));
select t.put('out_tok', to_jsonb(staff_sign_out('switch_user', :'sam2_token')));
select t.put('out_again', to_jsonb(staff_sign_out('switch_user', :'sam2_token')));
commit;
select t.ok(not (t.get('out_wrong_till'))::boolean and not (t.get('out_bad'))::boolean, 'a token cannot be ended from another till, nor a made-up one');
select t.ok((t.get('out_tok'))::boolean and not (t.get('out_again'))::boolean, 'sign-out by token works once');
select t.put('e', t.entry('auth', 'staff.sign_out'));
select t.ok((t.get('e') ->> 'staff_id') = :'sam' and (t.get('e') -> 'detail' ->> 'reason') = 'switch_user'
            and (t.get('e') ->> 'staff_trust') = 'pin', 'the sign-out entry names the person whose session ended');

-- An over-age session is ignored.
insert into auditlog.staff_sessions (staff_id, device, till_id, token_hash, trust, started_at)
values (:'sam', :'till2', 'till-2', sha256(convert_to('oldtoken', 'utf8')), 'pin', now() - interval '25 hours');
begin;
select t.req('till2', 'POST', '/stock_movements', 'oldtoken');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'wastage', 1, 'till-2');
commit;
select t.ok((t.entry('row', 'insert', 'stock_movements') ->> 'staff_trust') = 'none', 'a session older than the limit is ignored');

-- ── Client events ────────────────────────────────────────────────────────

select t.get('kim') -> 'session' ->> 'id' as kim_session \gset
begin;
select t.req('till1', 'POST', '/rpc/audit_log_events', :'kim_token');
select t.put('ev', audit_log_events(jsonb_build_array(
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000001', 'type', 'cart.line_removed', 'at', now(),
    'session_id', :'kim_session', 'severity', 1, 'detail', jsonb_build_object('product', 'Guinness', 'quantity', 2, 'value', 14.80)),
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000002', 'type', 'drawer.opened_no_sale', 'at', now() - interval '2 days',
    'session_id', :'kim_session', 'severity', 9),
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000003', 'type', 'report.exported', 'at', now(),
    'staff_id', :'sam'),
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000004', 'type', 'DROP TABLE', 'at', now()),
  jsonb_build_object('id', 'not-a-uuid', 'type', 'app.started'),
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000005', 'type', 'app.started', 'detail', jsonb_build_object('big', repeat('x', 7000))))));
commit;
select t.ok((t.get('ev') ->> 'accepted')::int = 4 and (t.get('ev') ->> 'rejected')::int = 2, 'valid events accepted, malformed ones rejected');
select t.put('e', t.entry('event', 'cart.line_removed'));
select t.ok((t.get('e') ->> 'staff_id') = :'kim' and (t.get('e') ->> 'staff_trust') = 'pin' and (t.get('e') ->> 'severity')::int = 1
            and (t.get('e') -> 'detail' ->> 'value')::numeric = 14.80 and (t.get('e') ->> 'client_at') is not null,
  'an event inside its session is attributed with PIN trust');
select t.put('e', t.entry('event', 'drawer.opened_no_sale'));
select t.ok((t.get('e') ->> 'staff_trust') = 'none' and (t.get('e') ->> 'severity')::int = 2,
  'an event dated outside its session is not attributed; severity is capped at 2');
select t.ok((t.entry('event', 'report.exported') ->> 'staff_trust') = 'claimed', 'a bare staff id on an event is a claim');
select t.ok((t.entry('event', 'app.started') -> 'detail' ->> 'truncated')::boolean, 'oversized detail is replaced, not stored');

begin;
select t.req('till1', 'POST', '/rpc/audit_log_events', :'kim_token');
select t.put('ev2', audit_log_events(jsonb_build_array(
  jsonb_build_object('id', 'e0000000-0000-0000-0000-000000000001', 'type', 'cart.line_removed', 'at', now()))));
commit;
select t.ok((t.get('ev2') ->> 'duplicate')::int = 1 and t.n('event', 'cart.line_removed') = 1, 're-sent events are not recorded twice');

-- ── What the server sees ─────────────────────────────────────────────────

begin;
select t.req('till1', 'POST', '/rpc/audit_ping', :'kim_token');
select t.put('ping', audit_ping());
commit;
select t.ok((t.get('ping') ->> 'till_id') = 'till-1' and (t.get('ping') ->> 'staff_id') = :'kim' and (t.get('ping') ->> 'staff_trust') = 'pin'
            and (t.get('ping') ->> 'saw_staff_header')::boolean and (t.get('ping') ->> 'saw_build_header')::boolean,
  'ping reports the till, the staff member and that both headers arrived');
begin;
select t.req('till1', 'POST', '/rpc/audit_ping');
select t.put('ping', audit_ping());
commit;
select t.ok((t.get('ping') ->> 'staff_trust') = 'none' and not (t.get('ping') ->> 'saw_staff_header')::boolean, 'ping with no session');

-- ── Who may do what ──────────────────────────────────────────────────────

begin;
select t.req('member', 'POST', '/rpc/x');
select t.put('m1', to_jsonb(t.refused($$select staff_sign_in('5a000000-0000-0000-0000-000000000001', '4821')$$)));
select t.put('m2', to_jsonb(t.refused($$select audit_log_events('[]'::jsonb)$$)));
select t.put('m3', to_jsonb(t.refused($$select audit_view()$$)));
select t.put('m4', to_jsonb(t.refused($$select count(*) from auditlog.log$$)));
select t.put('m7', to_jsonb(t.refused($$select audit_ping()$$)));
select t.put('m5', to_jsonb(t.refused($$select auditlog.verify()$$)));
select t.put('m6', to_jsonb(t.refused($$select staff_set_pin('5a000000-0000-0000-0000-000000000001', '0000')$$)));
commit;
select t.ok((t.get('m1'))::boolean and (t.get('m2'))::boolean and (t.get('m3'))::boolean and (t.get('m4'))::boolean
            and (t.get('m5'))::boolean and (t.get('m6'))::boolean, 'a member login can use none of it');

begin;
select t.req('anon', 'POST', '/rpc/x');
select t.put('a1', to_jsonb(t.refused($$select staff_sign_in('5a000000-0000-0000-0000-000000000001', '4821')$$)));
select t.put('a2', to_jsonb(t.refused($$select audit_view()$$)));
select t.put('a3', to_jsonb(t.refused($$select * from auditlog.staff_sessions$$)));
commit;
select t.ok((t.get('a1'))::boolean and (t.get('a2'))::boolean and (t.get('a3'))::boolean, 'anon can use none of it');

begin;
select t.req('service', 'GET', '/x');
select t.put('s1', to_jsonb(t.refused($$select count(*) from auditlog.log$$)));
select t.put('s2', to_jsonb(t.refused($$delete from auditlog.log$$)));
commit;
select t.ok((t.get('s1'))::boolean and (t.get('s2'))::boolean, 'even the service key cannot read or delete the log');

begin;
select t.req('till1', 'POST', '/rpc/x', :'kim_token');
select t.put('t1', to_jsonb(t.refused($$select count(*) from auditlog.log$$)));
select t.put('t2', to_jsonb(t.refused($$update auditlog.settings set guards_enforced = false$$)));
select t.put('t3', to_jsonb(t.refused($$select auditlog.erase_member_data('a0000000-0000-0000-0000-000000000003', 'x')$$)));
select t.put('t4', to_jsonb(t.refused($$insert into auditlog.log (kind, action, actor, row_hash) values ('row','fake','till','\x')$$)));
commit;
select t.ok((t.get('t1'))::boolean and (t.get('t2'))::boolean and (t.get('t3'))::boolean and (t.get('t4'))::boolean,
  'a till cannot touch the audit schema directly');

-- ── The viewer ───────────────────────────────────────────────────────────

begin;
select t.req('till1', 'POST', '/rpc/audit_view');
select t.put('v0', to_jsonb(t.refused($$select audit_view()$$)));
commit;
select t.ok((t.get('v0'))::boolean, 'the log cannot be read with nobody signed in');

begin;
select t.req('till1', 'POST', '/rpc/audit_view', :'kim_token');
select t.put('v1', audit_view());
select t.put('v2', audit_view(jsonb_build_object('table', 'products', 'pk', :'guinness')));
select t.put('v3', audit_view(jsonb_build_object('min_severity', 3, 'limit', 5)));
select t.put('v4', audit_view(jsonb_build_object('q', 'line_removed')));
select t.put('v5', audit_view(jsonb_build_object('kinds', jsonb_build_array('auth'), 'staff_id', :'kim')));
select t.put('v6', audit_view(jsonb_build_object('limit', 3)));
select t.put('v7', audit_view(jsonb_build_object('limit', 3, 'before_seq', (t.get('v6') ->> 'next_before_seq')::bigint)));
select t.put('v8', audit_view(jsonb_build_object('unchecked', true, 'limit', 500)));
select t.put('v10', audit_view(jsonb_build_object('actors', jsonb_build_array('database', 'service'), 'limit', 500)));
select t.put('v11', audit_view(jsonb_build_object('flag', 'member_discount_removed')));
commit;
select t.ok((select bool_and(e ->> 'actor' in ('database', 'service')) and count(*) > 5 from jsonb_array_elements(t.get('v10') -> 'entries') e),
  'actor filter: everything done outside the till');
select t.ok((select bool_and(e -> 'detail' -> 'flags' ? 'member_discount_removed') and count(*) = 1 from jsonb_array_elements(t.get('v11') -> 'entries') e),
  'flag filter');
select t.ok(jsonb_array_length(t.get('v1') -> 'entries') = 100, 'default page is 100 entries');
select t.ok((select bool_and(e ->> 'table' = 'products') and count(*) >= 4 from jsonb_array_elements(t.get('v2') -> 'entries') e),
  'history of one record');
select t.ok((t.get('v2') -> 'entries' -> 0 ->> 'subject') = 'Guinness', 'entries carry a human subject');
select t.ok(exists (select 1 from jsonb_array_elements(t.get('v2') -> 'entries') e where e ->> 'staff_name' = 'Sam Staff' and e ->> 'ip' = '203.0.113.10'),
  'entries carry the staff name and network address');
select t.ok((select bool_and((e ->> 'severity')::int = 3) and count(*) = 5 from jsonb_array_elements(t.get('v3') -> 'entries') e), 'severity filter + limit');
select t.ok(jsonb_array_length(t.get('v4') -> 'entries') = 1, 'free-text search');
select t.ok((select bool_and(e ->> 'kind' = 'auth' and e ->> 'staff_id' = :'kim') and count(*) >= 2 from jsonb_array_elements(t.get('v5') -> 'entries') e),
  'kind + staff filter');
select t.ok((t.get('v7') -> 'entries' -> 0 ->> 'seq')::bigint < (t.get('v6') -> 'entries' -> 2 ->> 'seq')::bigint, 'paging walks backwards');
select t.ok(t.n('system', 'log.viewed') = 1, 'viewing is logged once, not once per page');
select t.ok(not (t.get('v1')::text like '%TwRUUCA9qRhAKjf%'), 'no PIN hash reaches the viewer');

select (t.get('v8') -> 'entries' -> 0 ->> 'seq')::bigint as alert_seq \gset
begin;
select t.req('till1', 'POST', '/rpc/audit_ack', :'kim_token');
select audit_ack(:alert_seq, 'looked into it');
select t.put('v9', audit_view(jsonb_build_object('unchecked', true, 'limit', 500)));
select t.put('h', audit_health());
select t.put('sess', audit_sessions());
commit;
select t.ok(jsonb_array_length(t.get('v9') -> 'entries') = jsonb_array_length(t.get('v8') -> 'entries') - 1, 'a checked alert leaves the unchecked list');
select t.ok((select staff_id from auditlog.acks where seq = :alert_seq) = :'kim', 'who checked it is recorded');
select t.ok((t.get('h') ->> 'entries')::int > 100 and (t.get('h') -> 'coverage' -> 'missing') = '[]'::jsonb
            and (t.get('h') ->> 'capture_failures_7d')::int = 0 and (t.get('h') ->> 'unchecked_alerts')::int > 0, 'health strip reports');
select t.ok(jsonb_array_length(t.get('sess')) >= 4 and (t.get('sess') -> 0 ? 'staff_name'), 'who-was-signed-in list');

-- ── Tamper evidence ──────────────────────────────────────────────────────

begin;
select t.req('till1', 'POST', '/rpc/audit_verify_now', :'kim_token');
select t.put('ver', audit_verify_now());
select t.put('wit0', audit_seal_witness());
commit;
select t.ok((t.get('ver') ->> 'ok')::boolean and (t.get('ver') ->> 'unsealed_rows')::int <= 1, 'sealed and verified');
select t.ok((t.get('ver') -> 'head' ->> 'code') ~ '^S\d+-[0-9A-F]{4}-[0-9A-F]{4}$', 'seal has a short code');
select (t.get('wit0') -> 'head' ->> 'id')::bigint as seal_id \gset
select t.get('wit0') -> 'head' ->> 'hash' as seal_hash \gset

begin;
select t.req('till1', 'POST', '/rpc/audit_seal_witness');
select t.put('wit1', audit_seal_witness(:seal_id, :'seal_hash'));
select t.put('wit2', audit_seal_witness(:seal_id, repeat('0', 64)));
commit;
select t.ok((t.get('wit1') ->> 'match')::boolean, 'a till''s remembered seal matches');
select t.ok((t.get('wit2') ->> 'match')::boolean = false and (t.entry('system', 'integrity.witness_mismatch') ->> 'severity')::int = 3,
  'a seal the database no longer has is a serious alert');

-- Append-only, for everyone, including the superuser.
select t.ok(t.refused($$update auditlog.log set action = 'x' where seq = 5$$), 'log rows cannot be updated');
select t.ok(t.refused($$delete from auditlog.log where seq = 5$$), 'log rows cannot be deleted');
select t.ok(t.refused($$truncate auditlog.log$$), 'the log cannot be truncated');
select t.ok(t.refused($$update auditlog.log set seal_id = 999 where seal_id is null$$), 'seal ids cannot be set outside sealing');
select t.ok(t.refused($$update auditlog.seals set row_count = 1$$), 'seals cannot be updated');
select t.ok(t.refused($$delete from auditlog.seals$$), 'seals cannot be deleted');
select t.ok(t.refused($$update auditlog.staff_sessions set staff_id = gen_random_uuid()$$), 'sessions cannot be re-pointed');
select t.ok(t.refused($$update auditlog.staff_sessions set ended_at = null where ended_at is not null$$), 'sessions cannot be re-opened');
select t.ok(t.refused($$delete from auditlog.acks$$), 'checked marks cannot be removed');
select t.ok(t.refused($$delete from auditlog.origins$$), 'origins cannot be removed');

-- With the triggers switched off (full database access), tampering works —
-- and verification catches it. Each attempt is rolled back.
begin;
alter table auditlog.log disable trigger append_only;
update auditlog.log set new_data = jsonb_build_object('standard_price', 7.40)
 where table_name = 'products' and changed = array['standard_price'] and seal_id is not null
   and seq = (select min(seq) from auditlog.log where table_name = 'products' and changed = array['standard_price']);
select t.ok(not (auditlog.verify() ->> 'ok')::boolean and auditlog.verify() -> 'problems' -> 0 ->> 'problem' = 'row_content_changed',
  'editing a sealed entry is detected');
select t.ok(jsonb_array_length(auditlog.coverage() -> 'disabled') = 1, 'a switched-off audit trigger is reported');
rollback;

begin;
alter table auditlog.log disable trigger append_only;
delete from auditlog.log where seq = (select min(seq) from auditlog.log where kind = 'guard');
select t.ok(not (auditlog.verify() ->> 'ok')::boolean
            and exists (select 1 from jsonb_array_elements(auditlog.verify() -> 'problems') p where p ->> 'problem' = 'row_count_changed'),
  'deleting a sealed entry is detected');
rollback;

begin;
alter table auditlog.log disable trigger append_only;
alter table auditlog.log disable trigger log_before_insert;
insert into auditlog.log (kind, action, actor, row_hash, seal_id)
overriding user value
select 'row', 'forged', 'till', sha256('x'::bytea), 1;
select t.ok(not (auditlog.verify() ->> 'ok')::boolean, 'adding an entry to an old seal is detected');
rollback;

begin;
alter table auditlog.seals disable trigger append_only;
delete from auditlog.seals where id = (select max(id) from auditlog.seals);
select t.ok(not (auditlog.verify() ->> 'ok')::boolean
            and exists (select 1 from jsonb_array_elements(auditlog.verify() -> 'problems') p where p ->> 'problem' = 'seal_missing'),
  'removing a seal is detected');
rollback;

begin;
alter table public.orders disable trigger zz_audit_capture;
alter table public.order_items disable trigger zz_audit_capture_insert;
select t.ok(auditlog.coverage() -> 'disabled' ? 'orders', 'a table whose capture is switched off is reported');
select t.ok(auditlog.coverage() -> 'missing' ? 'order_items:insert', 'switched-off sale line capture is reported');
rollback;

select t.ok((auditlog.verify() ->> 'ok')::boolean, 'after the rollbacks the log verifies again');

-- Hashes do not depend on the session time zone.
set timezone = 'Asia/Tokyo';
select t.ok((auditlog.verify() ->> 'ok')::boolean, 'verification is time-zone independent');
reset timezone;

-- Nightly job.
select auditlog.nightly();
select t.ok(t.n('system', 'integrity.ok') = 1 and (select count(*) from auditlog.failures) = 0, 'nightly self-check passes and records it');
select auditlog.seal_job();
select t.ok((select count(*) from auditlog.log where seal_id is null) = 0, 'seal job leaves nothing unsealed');

-- ── Logging can never stop a sale ────────────────────────────────────────

-- Break the log on purpose, then ring a sale.
begin;
alter table auditlog.log add constraint broken_on_purpose check (kind = 'never') not valid;
select t.req('till1', 'POST', '/rpc/create_order_with_items', :'kim_token');
select create_order_with_items(
  jsonb_build_object('id', 'c0000000-0000-0000-0000-000000000099', 'staff_id', :'kim', 'payment_method', 'cash', 'total_amount', 7.40),
  jsonb_build_array(jsonb_build_object('product_id', :'guinness', 'quantity', 1, 'unit_price', 7.40)));
update products set standard_price = 7.50 where id = :'guinness';
select t.put('broken_signin', staff_sign_in(:'sam', '0000'));
-- Same transaction, but now as a direct table call (fresh context).
select t.req('till1', 'DELETE', '/orders', :'kim_token');
select set_config('auditlog.ctx_cache', '', true);
delete from orders where id = 'c0000000-0000-0000-0000-000000000004';
reset role;
select t.ok(exists (select 1 from orders where id = 'c0000000-0000-0000-0000-000000000099')
            and (select count(*) from order_items where order_id = 'c0000000-0000-0000-0000-000000000099') = 1,
  'with the log broken, a sale still goes through');
select t.ok((select standard_price from products where id = :'guinness') = 7.50, 'with the log broken, a product edit still saves');
select t.ok(not exists (select 1 from orders where id = 'c0000000-0000-0000-0000-000000000004'),
  'with the log broken the guard fails open: the write is allowed rather than the till jammed');
select t.ok((t.get('broken_signin') ->> 'valid')::boolean = false and (t.get('broken_signin') ->> 'attemptsRemaining')::int = 4,
  'with the log broken, PIN checks still answer');
select t.ok((select count(*) from auditlog.failures) >= 4, 'every failed capture is counted');
rollback;

-- Capture switched off entirely.
update auditlog.settings set capture_enabled = false;
select t.n('row') as before \gset
begin;
select t.req('till1', 'POST', '/stock_movements', :'kim_token');
insert into stock_movements (product_id, type, quantity, till_id) values (:'crisps', 'wastage', 1, 'till-1');
commit;
select t.ok(t.n('row') = :before, 'kill switch: no row capture');
update auditlog.settings set capture_enabled = true;

-- ── Erasure keeps the seals valid ────────────────────────────────────────

select auditlog.seal();
select auditlog.erase_member_data(:'mo', 'erasure request') as erased \gset
select t.ok(:erased >= 3, 'member entries erased');
select t.ok(not exists (select 1 from auditlog.log l where l.table_name = 'members' and l.row_pk = :'mo'
                          and (l.new_data::text like '%07700%' or l.old_data::text like '%07700%' or l.new_data::text like '%mo@example%')),
  'personal details are gone from the log');
select t.ok(exists (select 1 from auditlog.log l where l.table_name = 'members' and l.row_pk = :'mo' and l.changed = array['tab_balance']
                      and l.new_data ? 'tab_balance'), 'non-personal history (tab balance) is kept');
select t.ok((auditlog.verify() ->> 'ok')::boolean, 'the log still verifies after an erasure');
select t.ok((t.entry('system', 'privacy.erased') -> 'detail' ->> 'reason') = 'erasure request', 'the erasure is itself recorded');
select t.ok(t.n('system', 'audit.installed') = 1, 'the first entry marks where recording began');

-- ── Done ─────────────────────────────────────────────────────────────────

select t.ok((select count(*) from auditlog.failures) = 0, 'no capture failures at the end of the run');
drop schema t cascade;
\echo audit tests passed
