-- promotions and promotion_items are defined in 20260330000001_promotions.sql,
-- which sorts AFTER this file. Production applied the two out of order, so the
-- files cannot be renamed without desyncing the remote migration ledger.
-- Instead this migration carries guarded copies of the definitions so a fresh
-- database can replay the chain in lexical order; on databases where
-- 20260330000001 already ran, these are no-ops.

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  start_time time,
  end_time time,
  days_of_week integer[],   -- 0=Sun..6=Sat, null=every day
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

create table if not exists promotion_items (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid references promotions(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  discount_type text not null check (discount_type in ('fixed_price', 'percentage')),
  discount_value numeric(10,2) not null
);

create table if not exists promotion_categories (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  category text not null check (category in ('draught','bottle','spirit','soft','food','other')),
  discount_type text not null check (discount_type in ('percentage','fixed_price')),
  discount_value numeric(10,2) not null
);
