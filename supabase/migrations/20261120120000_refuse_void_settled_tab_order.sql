-- Refuse to void a tab order the member has already paid for.
--
-- 16 Nov 2026: Nick Bone ran up 6 × Fosters (£30) on tab and paid £30
-- cash on till 2 at 14:48. At 16:03 four of those drinks (£20) were
-- removed from a Tabs page left open from before the settlement. The
-- removal went through: the -£20 balance delta was swallowed by the
-- zero clamp in adjust_tab_balance, four Fosters were restocked, and the
-- £30 cash was left paying for £10 of drinks — a £20 hole on the day.
--
-- A drink on a settled tab has been paid for; taking it back is a refund,
-- not a tab removal. The till's removeOrderFromTab now checks this before
-- writing anything; this trigger is the backstop so a stale page on any
-- till can't get round it.
--
-- "Settled" means created at or before the member's last_settled_at,
-- which settle_tab stamps only on a FULL settlement, so orders on a
-- partially-paid tab stay removable. Settlement orders (cash/card) are
-- untouched, so undo_tab_settlement still works.

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
    if v_last_settled is not null and old.created_at <= v_last_settled then
      raise exception
        'This tab was paid off at % — a drink on it can''t be removed. Refund the customer instead.',
        to_char(v_last_settled at time zone 'Europe/London', 'HH24:MI DD Mon');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_refuse_void_settled_tab_order on orders;
create trigger orders_refuse_void_settled_tab_order
  before update of status on orders
  for each row execute function orders_refuse_void_settled_tab_order();
