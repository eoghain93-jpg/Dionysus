// src/lib/tabs.js
import { supabase } from './supabase'
import { selectMembers } from './members'

// A tab counts as overdue once this many days pass with no payment towards
// it (or, if nothing has ever been paid, since the tab was opened).
export const TAB_OVERDUE_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

// Whole days since the member last paid towards their tab. `unpaidSince`
// comes from the open_tab_ages RPC; null means it couldn't be worked out,
// in which case we show no age rather than guess.
export function tabStanding(unpaidSince, now = new Date()) {
  if (!unpaidSince) return { days: null, overdue: false }
  const days = Math.max(0, Math.floor((now.getTime() - new Date(unpaidSince).getTime()) / DAY_MS))
  return { days, overdue: days >= TAB_OVERDUE_DAYS }
}

// "No payment for N days" figures for open tabs, keyed by member id. Pass a
// member id to look up a single tab. Throws on error — callers decide
// whether the age is essential (it never is: a tab still works without it).
export async function fetchTabAges(member_id = null) {
  const { data, error } = await supabase.rpc('open_tab_ages', { p_member_id: member_id })
  if (error) throw error
  const ages = {}
  for (const row of data ?? []) {
    ages[row.member_id] = {
      unpaid_since: row.unpaid_since,
      last_paid_at: row.last_paid_at,
      ...tabStanding(row.unpaid_since),
    }
  }
  return ages
}

// Tab state is stored as a denormalized `tab_balance` column on the `members` table.
// A positive balance means the member has an open tab. Each tab is returned
// with how long it has gone unpaid (`days`, `overdue`) and whether staff
// have blocked it (`tab_blocked`).
export async function fetchOpenTabs() {
  // Named columns (never the PIN hash); falls back to '*' on a database
  // that hasn't had a listed column added yet, so the Tabs page still loads.
  const { data, error } = await selectMembers(columns => supabase
    .from('members')
    .select(columns)
    .gt('tab_balance', 0)
    .order('tab_balance', { ascending: false }))
  if (error) throw error
  const tabs = data ?? []
  if (tabs.length === 0) return tabs

  // The ages are a nice-to-have on top of the list: if the lookup fails the
  // Tabs page must still load so staff can settle.
  let ages = {}
  try {
    ages = await fetchTabAges()
  } catch (err) {
    console.error('Failed to load tab ages:', err)
  }
  return tabs.map(m => ({
    ...m,
    tab_blocked: !!m.tab_blocked,
    ...(ages[m.id] ?? { unpaid_since: null, last_paid_at: null, days: null, overdue: false }),
  }))
}

// Block or unblock a member's tab. Anyone can block; unblocking goes
// through the unblock_tab RPC, which only lets Admin and Nikki
// (members.can_unblock_tabs) do it, checked against the server-side staff
// session. Settling a blocked tab is never stopped.
export async function setTabBlocked(member_id, blocked, staff_id) {
  if (!blocked) {
    const { error } = await supabase.rpc('unblock_tab', { p_member_id: member_id })
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('members')
    .update({
      tab_blocked: true,
      tab_blocked_at: new Date().toISOString(),
      tab_blocked_by: staff_id ?? null,
    })
    .eq('id', member_id)
  if (error) throw error
}

// Whether this staff member may unblock tabs. Used to show or hide the
// Unblock button; the database makes the real decision.
export async function canUnblockTabs(staff_id) {
  if (!staff_id) return false
  try {
    const { data, error } = await supabase
      .from('members')
      .select('can_unblock_tabs')
      .eq('id', staff_id)
      .single()
    if (error) return false
    return !!data?.can_unblock_tabs
  } catch {
    return false
  }
}

// Fresh check right before a tab sale: the member on the order may have
// been looked up before another till blocked them. Never throws and never
// blocks on a failed lookup — a network blip must not stop a sale.
export async function isTabBlocked(member_id) {
  try {
    const { data, error } = await supabase
      .from('members')
      .select('tab_blocked')
      .eq('id', member_id)
      .single()
    if (error) return false
    return !!data?.tab_blocked
  } catch {
    return false
  }
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
  // 0. Refuse to remove a drink the member has already paid for. The Tabs
  //    page can be left open on a till showing a stale tab; removing a line
  //    from it after the tab was settled used to "succeed" — the balance
  //    delta was swallowed by the zero clamp, the drink was restocked, and
  //    the member's cash payment was left covering drinks the system now
  //    says were never served (16 Nov 2026: £20, four Fosters). A paid-for
  //    drink needs a refund, not a tab removal. The DB trigger
  //    orders_refuse_void_settled_tab_order enforces the same rule; this
  //    check runs first so we fail before any restock is written.
  const [{ data: order, error: ordErr }, { data: member, error: memErr }] = await Promise.all([
    supabase.from('orders').select('status, payment_method, created_at').eq('id', order_id).single(),
    supabase.from('members').select('last_settled_at').eq('id', member_id).single(),
  ])
  if (ordErr) throw ordErr
  if (memErr) throw memErr
  if (!order || order.status !== 'paid' || order.payment_method !== 'tab') {
    throw new Error('This drink is no longer on the tab — refresh the Tabs page.')
  }
  if (member?.last_settled_at && new Date(order.created_at) <= new Date(member.last_settled_at)) {
    throw new Error('This tab has already been paid off — that drink can\'t be removed. Refresh the Tabs page; if the customer was overcharged, refund them instead.')
  }

  // 1. Restore stock for each item on the voided order. We do this BEFORE
  //    marking the order voided so that a failure leaves the data in a
  //    safe intermediate state (tab balance still right, stock unchanged)
  //    rather than half-rolled. Restock movements use the DB trigger to
  //    increment products.stock_quantity automatically.
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('product_id, quantity, staff_credit_for')
    .eq('order_id', order_id)
  if (itemsError) throw itemsError

  if (items?.length) {
    const now = new Date().toISOString()
    // Staff-credit lines ("one for staff") never wrote a sale movement —
    // the stock only leaves when the banked drink is poured — so restocking
    // them here would inflate stock.
    const restocks = items
      .filter(i => i.product_id && !i.staff_credit_for)
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

  // Withdraw any banked staff drinks this order paid for. Only 'banked'
  // rows: an already-redeemed credit was poured and can't be un-drunk.
  const { error: creditsError } = await supabase
    .from('staff_drink_credits')
    .update({ status: 'cancelled' })
    .eq('order_id', order_id)
    .eq('status', 'banked')
  if (creditsError) throw creditsError

  await applyTabDelta(member_id, -order_total)
}
