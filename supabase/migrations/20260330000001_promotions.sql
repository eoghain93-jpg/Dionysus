-- supabase/migrations/20260330_promotions.sql
--
-- NOTE: on a fresh database these tables are already created by
-- 20260330000000_promotion_categories.sql (which sorts first but depends on
-- them — production applied the two out of order). The definitions there must
-- stay in sync with these; "if not exists" makes this file a no-op in that
-- case.

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
