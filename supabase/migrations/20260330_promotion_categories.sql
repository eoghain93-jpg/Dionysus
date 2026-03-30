create table promotion_categories (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete cascade,
  category text not null check (category in ('draught','bottle','spirit','soft','food','other')),
  discount_type text not null check (discount_type in ('percentage','fixed_price')),
  discount_value numeric(10,2) not null
);
