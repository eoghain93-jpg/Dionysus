-- Atomic tab balance adjustment.
--
-- Replaces the client-side read-modify-write pattern (fetch tab_balance,
-- add in JS, write back) used by tab adjustments, settlements and order
-- voids. Two tills hitting the same member concurrently could lose an
-- update; a single UPDATE with the delta applied in SQL cannot.
--
-- Clamps at zero to preserve the existing client behaviour (every caller
-- wrapped the new balance in Math.max(0, ...)) — a tab can be overpaid or
-- over-adjusted without going negative.
--
-- Returns the new balance so callers can branch on it (settleTab stamps
-- last_settled_at only when the balance hits zero).

create or replace function adjust_tab_balance(p_member_id uuid, p_delta numeric)
returns numeric
language plpgsql
as $$
declare
  v_new_balance numeric;
begin
  update members
    set tab_balance = greatest(0, coalesce(tab_balance, 0) + p_delta)
    where id = p_member_id
    returning tab_balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'Member % not found', p_member_id;
  end if;

  return v_new_balance;
end;
$$;

grant execute on function adjust_tab_balance(uuid, numeric) to anon, authenticated;
