-- Track when a member's tab was most recently settled to zero, so the
-- itemised tab view in the till can show only orders that contribute to
-- the CURRENT open tab — not every tab order in the member's history.
--
-- Set by settleTab() when a settlement brings the balance to zero. NULL
-- for members who have never had a settled-to-zero tab; that case is
-- treated as "show all tab orders" (the previous behaviour).

alter table members add column if not exists last_settled_at timestamptz;
