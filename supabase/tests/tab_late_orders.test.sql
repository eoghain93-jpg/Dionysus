-- Tests for 20261125120000_orders_recorded_at.sql: a tab drink replayed
-- from a till's offline queue after the tab was paid off.
--
-- Run with: supabase/tests/local-db.sh up && supabase/tests/local-db.sh test

\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
set client_min_messages = warning;

begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

insert into members (id, name, membership_number)
values ('7ab00000-0000-0000-0000-000000000001', 'Late Tab Test', 'T-LATE-1');

-- Two pints rung an hour ago; only the first reaches the database.
select create_order_with_items(
  jsonb_build_object('id', '7ab00000-0000-0000-0000-0000000000a1', 'member_id', '7ab00000-0000-0000-0000-000000000001',
                     'payment_method', 'tab', 'total_amount', 5.40, 'created_at', now() - interval '60 minutes'),
  '[]'::jsonb);

-- The member pays off what the tab shows. (now() is fixed inside a
-- transaction, so put the two stamps where real time would: the first
-- pint recorded as it was rung, the settlement after both were rung and
-- before the replay.)
select settle_tab('7ab00000-0000-0000-0000-000000000001', 5.40, 'cash', 'till-1');
update orders set recorded_at = created_at where id = '7ab00000-0000-0000-0000-0000000000a1';
update members set last_settled_at = now() - interval '30 minutes'
 where id = '7ab00000-0000-0000-0000-000000000001';

-- The second pint, rung before the settlement, is replayed now.
select create_order_with_items(
  jsonb_build_object('id', '7ab00000-0000-0000-0000-0000000000a2', 'member_id', '7ab00000-0000-0000-0000-000000000001',
                     'payment_method', 'tab', 'total_amount', 5.40, 'created_at', now() - interval '55 minutes'),
  '[]'::jsonb);

select pg_temp.ok((select tab_balance = 5.40 from members where id = '7ab00000-0000-0000-0000-000000000001'),
  'the replayed drink is on the balance');

-- What the Tabs page asks: rung or recorded after the last settlement.
select pg_temp.ok(
  (select array_agg(o.id::text) = array['7ab00000-0000-0000-0000-0000000000a2']
     from orders o join members m on m.id = o.member_id
    where m.id = '7ab00000-0000-0000-0000-000000000001' and o.payment_method = 'tab' and o.status <> 'voided'
      and (o.created_at > m.last_settled_at or o.recorded_at > m.last_settled_at)),
  'the replayed drink, and only it, is listed on the current tab');

select pg_temp.ok(
  (select unpaid_since >= (select last_settled_at from members where id = '7ab00000-0000-0000-0000-000000000001')
     from open_tab_ages('7ab00000-0000-0000-0000-000000000001')),
  'the tab''s age runs from when the drink arrived');

-- The drink that was paid for still cannot be removed...
do $$
begin
  update orders set status = 'voided' where id = '7ab00000-0000-0000-0000-0000000000a1';
  raise exception 'ASSERTION FAILED: a paid-for drink was voided';
exception when others then
  if sqlerrm not like 'This tab was paid off%' then raise; end if;
end $$;

-- ...the replayed one, which nobody has paid for, can.
update orders set status = 'voided' where id = '7ab00000-0000-0000-0000-0000000000a2';
select pg_temp.ok((select status = 'voided' from orders where id = '7ab00000-0000-0000-0000-0000000000a2'),
  'a late-arriving drink can be taken off the tab');

rollback;
