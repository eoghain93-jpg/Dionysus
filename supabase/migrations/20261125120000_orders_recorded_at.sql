-- A tab drink that reaches the database late must still show on the tab.
--
-- 23 Nov 2026, 16:49: till 1 loaded the new bundle, whose offline replay
-- sends every queued sale (the old one stopped at the first that failed
-- and only tried again when the connection came back). Eight sales that
-- had sat in till 1's queue since 25 Oct - 18 Nov went in at once. Six
-- were tab drinks:
--
--   Kim Lock          16 Nov  £10.00     Chris Allum      18 Nov  £10.40
--   Stuart Deeks      16 Nov   £5.00     Dave Brownlie    18 Nov   £5.40 x 2
--   John McLaughlin   18 Nov  £10.00
--
-- create_order_with_items added each to its member's tab_balance, and
-- stamped the order with the time it was RUNG (orders.created_at comes
-- from the till, so a sale lands on the right trading day). Every one of
-- those tabs had been paid off since, and the Tabs page lists drinks rung
-- after members.last_settled_at - so the balance went up and the drink was
-- nowhere to be seen. Staff saw "3 pints, £16.20" under a £26.60 total.
--
-- orders.recorded_at is when the row reached the database. A drink is on
-- the current tab when it was rung OR recorded after the last full
-- settlement. NULL (every order from before this migration that arrived
-- on time) means "recorded when rung".

alter table orders add column if not exists recorded_at timestamptz;
alter table orders alter column recorded_at set default now();

comment on column orders.recorded_at is
  'When the order reached the database. Later than created_at (when it was rung at the till) for a sale replayed from a till''s offline queue. NULL on orders from before 25 Nov 2026 that arrived on time: read as created_at.';

-- Orders already in that were replayed late. order_items.created_at has
-- always been the database clock, so the first line's timestamp is when
-- the order really arrived. Only the late ones are touched (a handful):
-- stamping every order would write tens of thousands of audit entries.
update orders o
   set recorded_at = i.arrived_at
  from (select order_id, min(created_at) as arrived_at from order_items group by order_id) i
 where i.order_id = o.id
   and o.recorded_at is null
   and i.arrived_at > o.created_at + interval '10 minutes';

-- The same rule for "has this drink been paid for?". A drink that only
-- arrived after the settlement was not part of what the member paid, so
-- it can be taken off (the fix for a double ring that was replayed late).
-- Otherwise as 20261120120000.
create or replace function orders_refuse_void_settled_tab_order()
returns trigger
language plpgsql
as $$
declare
  v_last_settled timestamptz;
begin
  if new.status = 'voided' and old.status is distinct from 'voided'
     and old.payment_method = 'tab' and old.member_id is not null then
    select last_settled_at into v_last_settled
      from members where id = old.member_id;
    if v_last_settled is not null
       and greatest(old.created_at, old.recorded_at) <= v_last_settled then
      raise exception
        'This tab was paid off at % — a drink on it can''t be removed. Refund the customer instead.',
        to_char(v_last_settled at time zone 'Europe/London', 'HH24:MI DD Mon');
    end if;
  end if;
  return new;
end;
$$;

-- open_tab_ages: a tab made up only of late-arriving drinks was "opened"
-- when they arrived. Otherwise as 20261122120000.
create or replace function open_tab_ages(p_member_id uuid default null)
returns table (member_id uuid, unpaid_since timestamptz, last_paid_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    greatest(t.opened_at, t.paid_at),
    t.paid_at
  from (
    select
      m.id,
      least(
        (select min(greatest(o.created_at, o.recorded_at))
           from orders o
          where o.member_id = m.id
            and o.payment_method = 'tab'
            and o.status <> 'voided'
            and greatest(o.created_at, o.recorded_at) > coalesce(m.last_settled_at, '-infinity'::timestamptz)),
        (select min(a.created_at)
           from tab_adjustments a
          where a.member_id = m.id
            and a.amount > 0
            and a.created_at > coalesce(m.last_settled_at, '-infinity'::timestamptz))
      ) as opened_at,
      greatest(
        (select max(o.created_at)
           from orders o
          where o.member_id = m.id
            and o.payment_method in ('cash', 'card')
            and o.status = 'paid'
            and (o.is_tab_settlement
                 or not exists (select 1 from order_items i where i.order_id = o.id))),
        (select max(p.created_at)
           from tab_payments p
          where p.member_id = m.id)
      ) as paid_at
    from members m
    where coalesce(m.tab_balance, 0) > 0
      and (p_member_id is null or m.id = p_member_id)
      -- Same guard as the other till RPCs: till devices (or service role) only.
      and (auth.uid() is null or is_till_device(auth.uid()))
  ) t;
$$;

revoke execute on function open_tab_ages(uuid) from public, anon;
grant execute on function open_tab_ages(uuid) to authenticated;
