-- Close the anon read gap left by RLS drift.
--
-- 20260610170000 dropped the "Allow all" policies by name and added
-- till-device + member-read-own policies. But production had extra
-- permissive policies re-added by hand under NON-standard names (Supabase
-- template names like "Enable read access for all users"), so the anon key
-- shipped in the bundle can still SELECT members, orders, etc. Writes are
-- already blocked; this closes the remaining read exposure.
--
-- Deterministic and safe: drop every policy on the locked-down tables that
-- is NOT one of our known-good policies, then this migration is idempotent
-- on re-run. The keep-list is the complete set of legitimate policies from
-- 20260319000000_member_auth and 20260610170000_till_device_rls.

do $$
declare
  r record;
  keep text[] := array[
    'Till device full access',
    'Authenticated read',
    'Till device write',
    'Till device update',
    'Till device delete',
    'Member read own row',
    'Member read own orders',
    'Member read own order items',
    'Member read own payments',
    'Device reads own row'
  ];
  locked_tables text[] := array[
    'members', 'orders', 'order_items', 'stock_movements', 'products',
    'tabs', 'suppliers', 'purchase_orders', 'purchase_order_items',
    'cashback_transactions', 'prize_wins', 'tab_adjustments',
    'promotions', 'promotion_items', 'promotion_categories',
    'z_reports', 'order_corrections', 'tab_payments',
    'till_devices', 'pin_attempts'
  ];
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any(locked_tables)
      and not (policyname = any(keep))
  loop
    raise notice 'dropping drifted policy "%" on %', r.policyname, r.tablename;
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;
