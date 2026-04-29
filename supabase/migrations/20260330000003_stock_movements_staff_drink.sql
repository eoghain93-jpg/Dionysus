-- supabase/migrations/20260330_stock_movements_staff_drink.sql
alter table stock_movements add column member_id uuid references members(id);
alter table stock_movements drop constraint stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','restock','wastage','spillage','adjustment','staff_drink'));
