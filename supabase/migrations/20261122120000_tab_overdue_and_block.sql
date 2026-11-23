-- Overdue tab alerts + staff tab block.
--
-- Two things the till needs to chase tabs that have been left to drift:
--
--   1. open_tab_ages — for every open tab, when the member last paid
--      something towards it, or (if they never have) when the tab was
--      opened. The till turns that into "no payment for N days" and flags
--      tabs past the threshold on the Tabs page, the nav badge and the
--      order panel.
--
--   2. members.tab_blocked — a switch staff flip from the Tabs page or the
--      member profile. While it is on, the till refuses to put more drinks
--      on that member's tab (cash or card only). Settling is unaffected.
--
-- The block is enforced by the till, NOT by create_order_with_items. That
-- RPC also replays orders queued offline, where the drink has already been
-- served: raising there would wedge the sync queue behind an order that can
-- never be saved.

alter table members add column if not exists tab_blocked boolean not null default false;
alter table members add column if not exists tab_blocked_at timestamptz;
alter table members add column if not exists tab_blocked_by uuid references members(id);

-- unpaid_since = the later of "tab opened" and "last payment".
--
--   opened    earliest unvoided tab order (or manual addition) since the
--             last FULL settlement — the same window the Tabs page lists.
--   last paid latest till settlement or member-app (Stripe) payment.
--             Settlements taken before 20261021190000 carry no
--             is_tab_settlement flag; they are recognisable as cash/card
--             orders against a member with no line items.
--
-- A payment older than the tab's opening belongs to a previous tab, so
-- greatest() lets the opening date win in that case. NULL when neither can
-- be worked out (the till then shows no age rather than guessing).
--
-- Pass a member id for one tab (the till's member lookup), or NULL for all.
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
        (select min(o.created_at)
           from orders o
          where o.member_id = m.id
            and o.payment_method = 'tab'
            and o.status <> 'voided'
            and o.created_at > coalesce(m.last_settled_at, '-infinity'::timestamptz)),
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
