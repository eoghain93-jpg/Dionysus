-- Cellar Intelligence Phase 1: containers + guided stocktakes.
-- Design: docs/plans/2026-07-02-cellar-intelligence-design.md
--
-- Managers count containers (kegs, cases), the till counts servings (pints,
-- bottles). Products gain the conversion so the UI can speak both. A
-- stocktake is a snapshot count: one header row, one line per counted
-- product, and one RELATIVE 'adjustment' stock movement per discrepancy so
-- stock_quantity re-baselines to what the human saw without wiping out
-- sales rung up while the count was in progress (an absolute set-to-counted
-- would). last_counted_at powers the "last verified N days ago" indicator.

-- ── Containers on products ────────────────────────────────────────────────
alter table products add column container_name text;           -- 'keg', 'case', 'box'
alter table products add column servings_per_container numeric(10,2);
alter table products add column case_size numeric(10,2);       -- bottles/cans per case, for ordering later
alter table products add column last_counted_at timestamptz;

-- ── Stocktake tables ──────────────────────────────────────────────────────
create table stocktakes (
  id uuid primary key,                      -- client-generated: offline replays are no-ops
  scope text not null default 'all',        -- 'all' or a product category
  staff_id uuid references members(id),
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create table stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  product_id uuid not null references products(id),
  expected_qty numeric(10,2) not null,      -- stock_quantity shown at count time
  counted_qty numeric(10,2) not null,       -- what the human saw
  variance_value_retail numeric(10,2) not null default 0,
  variance_value_cost numeric(10,2) not null default 0
);

create index stocktake_lines_by_stocktake on stocktake_lines (stocktake_id);
create index stocktake_lines_by_product on stocktake_lines (product_id);

-- Tie re-baselining adjustments back to the count that caused them, so
-- stock history can show WHY stock jumped.
alter table stock_movements add column stocktake_id uuid references stocktakes(id);

alter table stocktakes enable row level security;
alter table stocktake_lines enable row level security;

create policy "Till device full access" on stocktakes
  for all
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

create policy "Till device full access" on stocktake_lines
  for all
  using (is_till_device(auth.uid()))
  with check (is_till_device(auth.uid()));

-- ── Atomic finalize ───────────────────────────────────────────────────────
-- One transaction: header + lines + adjustment movements + last_counted_at.
-- Idempotent via the client-supplied stocktake id (same scheme as
-- create_order_with_items) so an offline count replayed by the sync queue
-- can't re-baseline stock twice. Variance is valued SERVER-side from the
-- products row — the client never supplies money figures. Same hardening as
-- the other definer RPCs (20260610170000): pinned search_path, in-body
-- till-device guard, no anon execute.
create or replace function finalize_stocktake(p_stocktake jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_completed timestamptz;
begin
  if auth.uid() is not null and not is_till_device(auth.uid()) then
    raise exception 'permission denied: till devices only';
  end if;

  v_id        := coalesce((p_stocktake->>'id')::uuid, gen_random_uuid());
  v_completed := coalesce((p_stocktake->>'completed_at')::timestamptz, now());

  insert into stocktakes (id, scope, staff_id, notes, started_at, completed_at)
  values (
    v_id,
    coalesce(p_stocktake->>'scope', 'all'),
    (p_stocktake->>'staff_id')::uuid,
    p_stocktake->>'notes',
    coalesce((p_stocktake->>'started_at')::timestamptz, now()),
    v_completed
  )
  on conflict (id) do nothing;

  -- Replayed offline sync: lines, adjustments and last_counted_at were
  -- already written with the original insert. Skip everything.
  if not found then
    return v_id;
  end if;

  insert into stocktake_lines
    (stocktake_id, product_id, expected_qty, counted_qty,
     variance_value_retail, variance_value_cost)
  select
    v_id,
    p.id,
    (l->>'expected_qty')::numeric,
    (l->>'counted_qty')::numeric,
    round(((l->>'counted_qty')::numeric - (l->>'expected_qty')::numeric) * p.standard_price, 2),
    round(((l->>'counted_qty')::numeric - (l->>'expected_qty')::numeric) * coalesce(p.cost_price, 0), 2)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l
  join products p on p.id = (l->>'product_id')::uuid;

  -- Relative delta, not absolute: quantity = counted - expected. The
  -- apply_stock_movement trigger applies 'adjustment' rows signed, so a
  -- negative delta decrements. Sales made during (or queued behind) the
  -- count keep their own movements and are not overwritten.
  insert into stock_movements (product_id, type, quantity, till_id, notes, stocktake_id, created_at)
  select
    (l->>'product_id')::uuid,
    'adjustment',
    (l->>'counted_qty')::numeric - (l->>'expected_qty')::numeric,
    p_stocktake->>'till_id',
    'Stocktake re-baseline',
    v_id,
    v_completed
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l
  where (l->>'counted_qty')::numeric <> (l->>'expected_qty')::numeric;

  -- Every counted product is now verified — including the ones that matched.
  update products
     set last_counted_at = v_completed
   where id in (
     select (l->>'product_id')::uuid
     from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l
   );

  return v_id;
end;
$$;

revoke execute on function finalize_stocktake(jsonb, jsonb) from public, anon;
grant execute on function finalize_stocktake(jsonb, jsonb) to authenticated;
