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

  // Only show orders that contribute to the CURRENT open tab. Without
  // this, the line items would include every tab order in the member's
  // history — orders from previously-settled tabs would clutter the view
  // and confuse customers who think they're being asked to pay again.
  const { data: member, error: memErr } = await supabase
    .from('members')
    .select('last_settled_at')
    .eq('id', member_id)
    .single()
  if (memErr) throw memErr
  const since = member?.last_settled_at ?? '1970-01-01'

  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, total_amount, order_items(id, product_id, quantity, unit_price, products(name))')
    .eq('member_id', member_id)
    .eq('payment_method', 'tab')
    .neq('status', 'voided')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Apply a delta to a member's tab balance in one atomic UPDATE via the
// adjust_tab_balance RPC (clamped at zero server-side). Returns the new
// balance. Never read-modify-write tab_balance from JS — two tills hitting
// the same member concurrently would lose an update.
export async function applyTabDelta(member_id, delta) {
  const { data, error } = await supabase.rpc('adjust_tab_balance', {
    p_member_id: member_id,
    p_delta: delta,
  })
  if (error) throw error
  return Number(data)
}

export async function adjustTabBalance(member_id, amount, reason, staff_id) {
  const { error: adjError } = await supabase
    .from('tab_adjustments')
    .insert({ member_id, amount, reason, staff_id })
  if (adjError) throw adjError

  await applyTabDelta(member_id, amount)
}

export async function removeOrderFromTab(order_id, member_id, order_total) {
  // 1. Restore stock for each item on the voided order. We do this BEFORE
  //    marking the order voided so that a failure leaves the data in a
  //    safe intermediate state (tab balance still right, stock unchanged)
  //    rather than half-rolled. Restock movements use the DB trigger to
  //    increment products.stock_quantity automatically.
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', order_id)
  if (itemsError) throw itemsError

  if (items?.length) {
    const now = new Date().toISOString()
    const restocks = items
      .filter(i => i.product_id)
      .map(i => ({
        product_id: i.product_id,
        type: 'restock',
        quantity: i.quantity,
        notes: `Restored from voided order ${order_id}`,
        created_at: now,
      }))
    if (restocks.length > 0) {
      const { error: stockError } = await supabase.from('stock_movements').insert(restocks)
      if (stockError) throw stockError
    }
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update({ status: 'voided' })
    .eq('id', order_id)
  if (orderError) throw orderError

  await applyTabDelta(member_id, -order_total)
}
