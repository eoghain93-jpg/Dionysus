-- Record the £20 cash refund given to Nick Bone (Pixie) on 16 Nov 2026.
--
-- He ran up 6 × Fosters (£30) on tab and paid £30 cash on till 2 at 14:48.
-- At 16:03 the landlady removed four of those pints (£20) — he hadn't had
-- them — and handed him £20 back from till 2. The removal was recorded
-- (orders voided, stock restored) but the cash going back out never was,
-- so the books showed £30 taken for £10 of drinks: the £20 discrepancy.
--
-- A 'refunded' order is how the Z report and monthly report count money
-- returned to a customer (it comes off net revenue). Timestamped at the
-- removal. The NOT EXISTS guard makes re-runs and fresh environments no-ops.

insert into orders (member_id, till_id, payment_method, total_amount, status,
                    is_tab_settlement, created_at)
select 'a1ae7c01-2b2b-4676-9420-26f9233c525b', 'till-2', 'cash', 20.00, 'refunded',
       false, '2026-11-16T16:03:41Z'
where exists (select 1 from members where id = 'a1ae7c01-2b2b-4676-9420-26f9233c525b')
  and not exists (
    select 1 from orders
    where member_id = 'a1ae7c01-2b2b-4676-9420-26f9233c525b'
      and status = 'refunded'
      and created_at = '2026-11-16T16:03:41Z'
  );
