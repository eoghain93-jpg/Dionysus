-- Restore four drawer counts destroyed by Close Day overwrites, and stop
-- it happening again at the database level.
--
-- The Z modal initialises both Actual Cash boxes to 0 and upserts on
-- report_date with no already-closed guard, so a second Close Day press
-- (from a blank form, or from the other till with only its own count
-- typed in) silently overwrote real counts. The true figures below were
-- recovered from the z-report emails (from epos@fairmile.club, which
-- preserve the per-till actuals exactly as typed at each close):
--
--   2026-05-30  stored 165.30 → 675.25
--     21:59 close: till 1 counted £509.95 (exact); 22:05 close entered
--     only till 2 £165.30 (exact) and wiped till 1. 675.25 = 509.95 + 165.30.
--   2026-06-08  stored 0.00 → 404.25
--     21:00 close: both tills counted, both exact (284.25 + 120.00);
--     blank-form re-close at 11:12 the next morning zeroed it.
--   2026-06-11  stored 568.00 → 698.00
--     21:55 close: till 1 £568.00, till 2 £130.00; 21:57 stale close
--     from the other till dropped till 2. 698.00 = 568.00 + 130.00.
--   2026-06-15  stored 155.00 → 365.00
--     21:34 close: till 1 £210.00; 21:35 close: till 2 £155.00 only.
--     365.00 = 210.00 + 155.00.
--
-- 2026-05-08 and 2026-05-24 also store 0.00 but their emails show no
-- count was ever entered — nothing to restore, left as-is.
--
-- Old-value guards make re-runs and fresh environments no-ops.

update z_reports set actual_cash = 675.25 where report_date = '2026-05-30' and actual_cash = 165.30;
update z_reports set actual_cash = 404.25 where report_date = '2026-06-08' and actual_cash = 0.00;
update z_reports set actual_cash = 698.00 where report_date = '2026-06-11' and actual_cash = 568.00;
update z_reports set actual_cash = 365.00 where report_date = '2026-06-15' and actual_cash = 155.00;

-- Guard: once a nonzero count is recorded for a day, an UPDATE may not
-- zero it. Defence in depth beneath the till UI (which is separately
-- gaining a re-close confirmation and per-till count merging): whatever
-- the client does, the worst class of overwrite — a recorded drawer
-- count replaced by an untouched £0 form — now fails loudly instead of
-- silently rewriting history. Genuine corrections set a real figure and
-- pass; the rare legitimate zeroing can be done by an admin after
-- disabling the trigger.

create or replace function z_reports_protect_actual_cash()
returns trigger
language plpgsql
as $$
begin
  if old.actual_cash is not null and old.actual_cash <> 0
     and (new.actual_cash is null or new.actual_cash = 0) then
    raise exception
      'a cash count of % is already recorded for % — refusing to overwrite it with zero. Enter the real count, or ask the admin to correct it.',
      old.actual_cash, old.report_date;
  end if;
  return new;
end;
$$;

drop trigger if exists z_reports_protect_actual_cash on z_reports;
create trigger z_reports_protect_actual_cash
  before update on z_reports
  for each row execute function z_reports_protect_actual_cash();
