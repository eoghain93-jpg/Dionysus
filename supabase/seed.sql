-- =============================================================
-- Club EPOS — Sample Seed Data
-- Run against your Supabase project after applying schema.sql
-- Safe to re-run: uses ON CONFLICT DO NOTHING / DO UPDATE
-- =============================================================

-- ----------------------------------------------------------
-- 1. Supplier
-- ----------------------------------------------------------
INSERT INTO suppliers (name, contact_name, phone, email)
VALUES ('Real Ales Ltd', 'John Barleycorn', '01234 567890', 'orders@realales.example.com')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- 2. Products (all 6 categories)
-- ----------------------------------------------------------

-- draught
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit, supplier_id)
SELECT 'Guinness', 'draught', 5.50, 4.80, 40, 20, 'pint', id
FROM suppliers WHERE name = 'Real Ales Ltd'
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit, supplier_id)
SELECT 'Carlsberg', 'draught', 4.80, 4.20, 35, 20, 'pint', id
FROM suppliers WHERE name = 'Real Ales Ltd'
ON CONFLICT (sku) DO NOTHING;

-- bottle
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit, supplier_id)
SELECT 'Heineken 330ml', 'bottle', 4.00, 3.50, 48, 24, 'bottle', id
FROM suppliers WHERE name = 'Real Ales Ltd'
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit, supplier_id)
SELECT 'Peroni 330ml', 'bottle', 4.20, 3.70, 36, 24, 'bottle', id
FROM suppliers WHERE name = 'Real Ales Ltd'
ON CONFLICT (sku) DO NOTHING;

-- spirit
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Jameson Whiskey', 'spirit', 4.50, 3.90, 30, 10, 'measure')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Gordons Gin', 'spirit', 4.20, 3.60, 25, 10, 'measure')
ON CONFLICT (sku) DO NOTHING;

-- soft
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Coca Cola 330ml', 'soft', 2.50, 2.00, 72, 36, 'bottle')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Orange Juice', 'soft', 2.80, 2.30, 20, 10, 'each')
ON CONFLICT (sku) DO NOTHING;

-- food
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Cheese & Onion Crisps', 'food', 1.50, 1.20, 60, 30, 'each')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Peanuts', 'food', 1.50, 1.20, 60, 30, 'each')
ON CONFLICT (sku) DO NOTHING;

-- other
INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Club Membership Badge', 'other', 5.00, 4.00, 20, 5, 'each')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO products (name, category, standard_price, member_price, stock_quantity, par_level, unit)
VALUES ('Raffle Ticket', 'other', 1.00, 1.00, 100, 50, 'each')
ON CONFLICT (sku) DO NOTHING;

-- ----------------------------------------------------------
-- 3. Members
-- ----------------------------------------------------------

-- Regular members
INSERT INTO members (name, membership_number, phone, email, membership_tier, tab_balance, renewal_date, favourite_drinks)
VALUES (
  'Alice Murphy', 'MEM-001', '07700 900001', 'alice@example.com',
  'member', 12.50,
  CURRENT_DATE + INTERVAL '15 days',
  ARRAY['Guinness','Jameson Whiskey']
)
ON CONFLICT (membership_number) DO NOTHING;

INSERT INTO members (name, membership_number, phone, email, membership_tier, tab_balance, renewal_date)
VALUES (
  'Bob Kelly', 'MEM-002', '07700 900002', 'bob@example.com',
  'member', 0,
  CURRENT_DATE + INTERVAL '90 days'
)
ON CONFLICT (membership_number) DO NOTHING;

INSERT INTO members (name, membership_number, phone, email, membership_tier, tab_balance, renewal_date, favourite_drinks)
VALUES (
  'Carol Flynn', 'MEM-003', '07700 900003', 'carol@example.com',
  'member', 45.00,
  CURRENT_DATE + INTERVAL '200 days',
  ARRAY['Peroni 330ml','Gordons Gin']
)
ON CONFLICT (membership_number) DO NOTHING;

-- Staff members
INSERT INTO members (name, membership_number, phone, email, membership_tier, tab_balance, renewal_date)
VALUES (
  'Dave O Brien', 'STF-001', '07700 900004', 'dave@example.com',
  'staff', 0,
  CURRENT_DATE + INTERVAL '365 days'
)
ON CONFLICT (membership_number) DO NOTHING;

INSERT INTO members (name, membership_number, phone, email, membership_tier, tab_balance, renewal_date)
VALUES (
  'Eve Gallagher', 'STF-002', '07700 900005', 'eve@example.com',
  'staff', 0,
  CURRENT_DATE + INTERVAL '365 days'
)
ON CONFLICT (membership_number) DO NOTHING;

-- ----------------------------------------------------------
-- 4. Tabs (for members with outstanding balances)
-- ----------------------------------------------------------

-- Alice's tab
INSERT INTO tabs (member_id, balance)
SELECT id, 12.50 FROM members WHERE membership_number = 'MEM-001'
ON CONFLICT (member_id) DO UPDATE SET balance = 12.50;

-- Carol's tab
INSERT INTO tabs (member_id, balance)
SELECT id, 45.00 FROM members WHERE membership_number = 'MEM-003'
ON CONFLICT (member_id) DO UPDATE SET balance = 45.00;
