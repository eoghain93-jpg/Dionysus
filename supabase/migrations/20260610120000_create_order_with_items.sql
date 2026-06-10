-- Atomic, idempotent order creation.
--
-- Replaces the client-side sequence of separate inserts (orders,
-- order_items, stock_movements) + tab balance read-modify-write, which
-- could partially fail and leave paid orders with no line items, stock
-- undecremented, or tab balances out of date.
--
-- One transaction (the function body) does all of:
--   1. insert the order        — idempotent via ON CONFLICT (id) DO NOTHING,
--                                 so a replayed offline sync is a no-op
--   2. insert the order items
--   3. insert 'sale' stock_movements rows — the existing
--      apply_stock_movement trigger decrements products.stock_quantity,
--      so we must NOT touch stock_quantity here (no double-decrement)
--   4. if payment_method = 'tab', atomically increment the member's
--      tab_balance (single UPDATE, no read-modify-write)
--
-- The client supplies the order id (crypto.randomUUID()), generated once
-- at checkout time and kept on offline-queued orders, so the same sale can
-- never land twice however many times the sync replays it.

create or replace function create_order_with_items(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
as $$
declare
  v_order_id       uuid;
  v_member_id      uuid;
  v_payment_method text;
  v_total          numeric(10,2);
  v_till_id        text;
  v_status         text;
  v_created_at     timestamptz;
begin
  -- Orders queued before this function shipped have no id; generate one so
  -- they still sync (without replay protection, as before).
  v_order_id       := coalesce((p_order->>'id')::uuid, gen_random_uuid());
  v_member_id      := (p_order->>'member_id')::uuid;
  v_payment_method := p_order->>'payment_method';
  v_total          := (p_order->>'total_amount')::numeric;
  v_till_id        := coalesce(p_order->>'till_id', 'till-1');
  v_status         := coalesce(p_order->>'status', 'paid');
  v_created_at     := coalesce((p_order->>'created_at')::timestamptz, now());

  insert into orders (id, member_id, till_id, payment_method, total_amount, status, created_at)
  values (v_order_id, v_member_id, v_till_id, v_payment_method, v_total, v_status, v_created_at)
  on conflict (id) do nothing;

  -- Replayed sync: the order already exists, so its items, stock movements
  -- and tab balance were already written. Skip everything.
  if not found then
    return v_order_id;
  end if;

  insert into order_items (order_id, product_id, quantity, unit_price, member_price_applied)
  select
    v_order_id,
    (i->>'product_id')::uuid,
    (i->>'quantity')::numeric,
    (i->>'unit_price')::numeric,
    coalesce((i->>'member_price_applied')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  -- Stock movement timestamps use the order's created_at so offline sales
  -- land with the time the sale actually happened, not the sync time.
  insert into stock_movements (product_id, type, quantity, till_id, created_at)
  select
    (i->>'product_id')::uuid,
    'sale',
    (i->>'quantity')::numeric,
    v_till_id,
    v_created_at
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where i->>'product_id' is not null;

  if v_payment_method = 'tab' and v_member_id is not null then
    update members
      set tab_balance = tab_balance + v_total
      where id = v_member_id;
  end if;

  return v_order_id;
end;
$$;

grant execute on function create_order_with_items(jsonb, jsonb) to anon, authenticated;
