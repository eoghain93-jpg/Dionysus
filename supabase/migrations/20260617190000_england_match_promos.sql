-- England match night (2026-06-17) promotions.
--
-- Both rows are created switched OFF. Staff toggle them ON from the Promos
-- page at kickoff (21:00) and OFF again when the time comes; each is dated to
-- 2026-06-17 only, so it auto-stops at midnight as a backstop.
--
--   1. "50p Off Pints (England)" — 50p off every full draught pint, run until
--      England score (staff toggle it off). Implemented as per-product
--      fixed_price = current standard price minus 50p. Half-pints are NOT
--      included (matched by exact full-pint name).
--
--   2. "Bottle 5-for-4" — a MARKER promo with no discount rows. It is purely an
--      on/off switch: while it is active the till shows the "5 for 4 Bottles"
--      button (see isBundleEnabled in src/lib/promos.js). The actual 5-for-4
--      pricing is computed in the app (addBottleBundle), not here.
--
-- Idempotent: guarded by name so re-running (or replay on a fresh DB) will not
-- duplicate. On a fresh DB with no matching products the pint promo is simply
-- created with no items, which is harmless.

-- 1. 50p off pints — created OFF.
insert into promotions (name, active, start_date, end_date)
select '50p Off Pints (England)', false, '2026-06-17', '2026-06-17'
where not exists (select 1 from promotions where name = '50p Off Pints (England)');

-- 2. Bottle 5-for-4 marker — created OFF, no discount rows.
insert into promotions (name, active, start_date, end_date)
select 'Bottle 5-for-4', false, '2026-06-17', '2026-06-17'
where not exists (select 1 from promotions where name = 'Bottle 5-for-4');

-- Per-pint fixed prices for the 50p promo. Derived from the live standard
-- price so it stays correct if a pint's price differs from expectation.
do $$
declare
  v_promo uuid;
begin
  select id into v_promo from promotions where name = '50p Off Pints (England)' limit 1;
  if v_promo is null then
    return;
  end if;

  -- Clear any prior items for this promo so the set is exactly the lineup below.
  delete from promotion_items where promotion_id = v_promo;

  insert into promotion_items (promotion_id, product_id, discount_type, discount_value)
  select v_promo, p.id, 'fixed_price', round((p.standard_price - 0.50)::numeric, 2)
  from products p
  where p.category = 'draught'
    and p.name in (
      'Carlsberg', 'Fosters', 'Guinness', 'Kronenbourg',
      'Poretti', 'Stay Jammy', 'Tetley', 'Thatchers Gold'
    )
    and p.standard_price > 0.50;
end $$;
