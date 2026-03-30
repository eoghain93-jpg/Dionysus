# Promotions — Design

## Goal

Staff can create named promotions that apply a fixed price or percentage discount to specific products. Promos can be time-based (recurring happy hour) or date-range-based (one-off events like St Patrick's Day). Active promos override pricing at the till automatically.

## Database

```sql
create table promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- e.g. "Happy Hour", "St Patrick's Day"
  active boolean not null default true,
  -- Recurring time window (optional)
  start_time time,                             -- e.g. 17:00
  end_time time,                               -- e.g. 19:00
  days_of_week integer[],                      -- 0=Sun, 1=Mon ... 6=Sat (null = every day)
  -- One-off date range (optional)
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

create table promotion_items (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid references promotions(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  discount_type text not null check (discount_type in ('fixed_price', 'percentage')),
  discount_value numeric(10,2) not null       -- £4.00 for fixed_price, 20 for 20% off
);
```

A promo is active if: `active = true` AND (current time is within `start_time`–`end_time` on a matching `days_of_week`) OR (today is within `start_date`–`end_date`). Both conditions can apply simultaneously.

## Till Pricing Logic

When building an order, after resolving member/standard price, check for active promos:
1. Fetch active promotions (cached, refreshed every 5 minutes)
2. For each item, check if any active promo covers that `product_id`
3. If yes, calculate promo price:
   - `fixed_price`: use `discount_value` directly
   - `percentage`: `price * (1 - discount_value / 100)`
4. Take the **lowest** price (promo never increases price)
5. Show a "promo" label on the product tile in the grid

## Promos Admin Page

New "Promos" page in the till admin (alongside Members, Stock, Reports):
- List of all promotions with active/inactive toggle
- Create promo: name, time window or date range, add product lines with discount type + value
- Edit / delete promos
- No PIN required (already inside staff till)

## Examples

| Promo | Type | Config |
|-------|------|--------|
| Happy Hour | Recurring | Mon–Fri 17:00–19:00, 20% off all draught |
| St Patrick's Day | One-off | 17 Mar 2026, Guinness fixed £4.00 |
| Staff Drinks | Recurring | Every day 22:00–23:00, 50% off everything |
