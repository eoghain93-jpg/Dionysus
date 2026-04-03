// src/lib/tabs.js
import { supabase } from './supabase'

// Tab state is stored as a denormalized `tab_balance` column on the `members` table.
// A positive balance means the member has an open tab.
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
  if (!member_id) return []
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, total_amount, order_items(id, product_id, quantity, unit_price, products(name))')
    .eq('member_id', member_id)
    .eq('payment_method', 'tab')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function adjustTabBalance(member_id, amount, reason, staff_id) {
  const { error: adjError } = await supabase
    .from('tab_adjustments')
    .insert({ member_id, amount, reason, staff_id })
  if (adjError) throw adjError

  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Number(member.tab_balance) + amount
  const { error: updateError } = await supabase
    .from('members')
    .update({ tab_balance: Math.max(0, newBalance) })
    .eq('id', member_id)
  if (updateError) throw updateError
}

export async function removeOrderFromTab(order_id, member_id, order_total) {
  const { error: orderError } = await supabase
    .from('orders')
    .update({ payment_method: 'removed' })
    .eq('id', order_id)
  if (orderError) throw orderError

  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Math.max(0, Number(member.tab_balance) - order_total)
  const { error: updateError } = await supabase
    .from('members')
    .update({ tab_balance: newBalance })
    .eq('id', member_id)
  if (updateError) throw updateError
}
