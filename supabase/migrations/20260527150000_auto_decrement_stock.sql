-- Auto-decrement (or increment) products.stock_quantity whenever a
-- stock_movements row is inserted. Sign is derived from the movement type
-- so the client doesn't need to call adjust_stock separately and can't
-- accidentally double-count.
--
-- Mapping:
--   sale       → −quantity   (drink left the building, paid for)
--   wastage    → −quantity   (line clean, spillage etc. logged as wastage)
--   spillage   → −quantity   (legacy synonym of wastage)
--   staff_drink → −quantity  (comped drink, consumed)
--   restock    → +quantity   (supplier delivery)
--   adjustment → +quantity   (stocktake correction; insert NEGATIVE quantity
--                             to represent a downward adjustment)
--
-- This trigger replaces the client-side adjust_stock RPC call for sales,
-- and makes offline-then-synced movements correctly affect stock when they
-- finally land in the DB.

create or replace function apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_delta numeric;
begin
  v_delta := case NEW.type
    when 'sale'        then -NEW.quantity
    when 'wastage'     then -NEW.quantity
    when 'spillage'    then -NEW.quantity
    when 'staff_drink' then -NEW.quantity
    when 'restock'     then  NEW.quantity
    when 'adjustment'  then  NEW.quantity
    else 0
  end;

  if v_delta <> 0 and NEW.product_id is not null then
    update products
      set stock_quantity = stock_quantity + v_delta
      where id = NEW.product_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists stock_movement_apply on stock_movements;
create trigger stock_movement_apply
  after insert on stock_movements
  for each row
  execute function apply_stock_movement();

-- Extend the type check constraint to include 'staff_drink' if it isn't
-- already (older migrations may have a tighter set). Idempotent — drops if
-- present, then adds the full union.
alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','restock','wastage','spillage','adjustment','staff_drink'));
