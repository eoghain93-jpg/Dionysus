// src/lib/tabs.js
import { supabase } from './supabase'

export async function fetchOpenTabs() {
  const { data, error } = await supabase
    .from('members')
    .select('id, name, tab_balance, membership_number')
    .gt('tab_balance', 0)
    .order('tab_balance', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchTabOrders(member_id) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, total_amount, order_items(id, product_id, quantity, unit_price, products(name))')
    .eq('member_id', member_id)
    .eq('payment_method', 'tab')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
