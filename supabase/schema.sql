-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Suppliers
create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

-- Products
create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null check (category in ('draught','bottle','spirit','soft','food','other')),
  sku text unique,
  standard_price numeric(10,2) not null,
  member_price numeric(10,2) not null,
  stock_quantity numeric(10,2) default 0,
  par_level numeric(10,2) default 0,
  unit text not null default 'each' check (unit in ('pint','measure','bottle','each')),
  supplier_id uuid references suppliers(id),
  cost_price numeric(10,2),
  active boolean default true,
  created_at timestamptz default now()
);

-- Members
create table members (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  membership_number text unique not null,
  phone text,
  email text,
  membership_tier text not null default 'member' check (membership_tier in ('member','staff')),
  tab_balance numeric(10,2) default 0,
  renewal_date date,
  favourite_drinks text[],
  notes text,
  active boolean default true,
  created_at timestamptz default now()
);

-- Orders
create table orders (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid references members(id),
  till_id text not null default 'till-1',
  payment_method text not null check (payment_method in ('cash','card','tab')),
  total_amount numeric(10,2) not null,
  status text not null default 'paid' check (status in ('open','paid','voided')),
  created_at timestamptz default now()
);

-- Order Items
create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  quantity numeric(10,2) not null,
  unit_price numeric(10,2) not null,
  member_price_applied boolean default false,
  created_at timestamptz default now()
);

-- Tabs
create table tabs (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid unique references members(id),
  balance numeric(10,2) default 0,
  last_activity timestamptz default now(),
  created_at timestamptz default now()
);

-- Stock Movements
create table stock_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id),
  type text not null check (type in ('sale','restock','wastage','spillage','adjustment')),
  quantity numeric(10,2) not null,
  notes text,
  till_id text,
  created_at timestamptz default now()
);

-- Purchase Orders
create table purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  supplier_id uuid references suppliers(id),
  status text not null default 'draft' check (status in ('draft','sent','received')),
  total_cost numeric(10,2),
  notes text,
  created_at timestamptz default now(),
  received_at timestamptz
);

-- Purchase Order Items
create table purchase_order_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  product_id uuid references products(id),
  quantity_ordered numeric(10,2) not null,
  quantity_received numeric(10,2) default 0,
  unit_cost numeric(10,2)
);

-- Enable Row Level Security
alter table members enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table tabs enable row level security;
alter table stock_movements enable row level security;
alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;

-- Open policies (all authenticated + anon users can do everything for now)
create policy "Allow all" on members for all using (true) with check (true);
create policy "Allow all" on products for all using (true) with check (true);
create policy "Allow all" on orders for all using (true) with check (true);
create policy "Allow all" on order_items for all using (true) with check (true);
create policy "Allow all" on tabs for all using (true) with check (true);
create policy "Allow all" on stock_movements for all using (true) with check (true);
create policy "Allow all" on suppliers for all using (true) with check (true);
create policy "Allow all" on purchase_orders for all using (true) with check (true);
create policy "Allow all" on purchase_order_items for all using (true) with check (true);

-- Stock adjustment function
create or replace function adjust_stock(p_product_id uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  update products set stock_quantity = stock_quantity + p_delta where id = p_product_id;
end;
$$;
