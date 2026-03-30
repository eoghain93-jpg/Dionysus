# Wastage & Staff Drinks — Design

## Goal

Replace paper-based wastage and staff drink tracking with quick-log buttons on the till, feeding into the Z report.

## Database

Two changes to `stock_movements`:

1. Add `member_id` column for staff drink attribution:
```sql
alter table stock_movements add column member_id uuid references members(id);
```

2. Add `staff_drink` to the type check constraint:
```sql
alter table stock_movements drop constraint stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','restock','wastage','spillage','adjustment','staff_drink'));
```

## Till UI

Two buttons on the TillPage below the product grid: **Wastage** and **Staff Drink**.

### Wastage Modal
- Product dropdown — draught products only
- Quantity field (pints, numeric)
- Confirm button
- Saves to `stock_movements`: type `wastage`, product_id, quantity, till_id

### Staff Drink Modal
- Product dropdown — all active products
- Quantity field (defaults to 1)
- Confirm button
- Saves to `stock_movements`: type `staff_drink`, product_id, quantity, member_id from active session, till_id

Both modals are minimal — no unnecessary fields.

## Z Report

Two new lines in both the on-screen `ZReportModal` and the `send-z-report` email:

- **Wastage**: total units wasted + value (quantity × standard_price), broken down by product
- **Staff drinks**: per staff member subtotal (name, item count, value) + overall total

Data sourced from `stock_movements` filtered by `report_date` and type.

## Data Layer

New functions in `src/lib/stockMovements.js`:
- `logWastage(product_id, quantity, till_id)` — inserts wastage row
- `logStaffDrink(product_id, quantity, member_id, till_id)` — inserts staff_drink row
- `fetchWastageForDate(date)` — returns wastage rows joined with product name/price
- `fetchStaffDrinksForDate(date)` — returns staff_drink rows joined with product and member name
