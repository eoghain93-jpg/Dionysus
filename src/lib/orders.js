import { supabase } from './supabase'
import { db } from './db'
import { tradingDayRange, tradingTodayISO } from './tradingDay'

// Generate a client-side order id at checkout time. The id travels with the
// order whether it's saved online or queued offline, so the
// create_order_with_items RPC can make replayed syncs a no-op
// (ON CONFLICT (id) DO NOTHING).
export function newOrderId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  // crypto.randomUUID needs a secure context; the till is served over plain
  // http on the pub LAN, so fall back to a v4 UUID built from
  // getRandomValues (available in non-secure contexts).
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Create the order, its items, the sale stock movements and any tab balance
// increment in ONE database transaction via the create_order_with_items RPC.
// Throws on error (the Supabase client returns errors rather than throwing).
export async function createOrderWithItems(order, items) {
  const { data, error } = await supabase.rpc('create_order_with_items', {
    p_order: order,
    p_items: items,
  })
  if (error) throw error
  return data
}

// Today's paid sales, newest first — the Fix Payment list. Capped at 50:
// mistakes are caught within a few sales, nobody scrolls to this morning.
// Trading-day window, so a sale rung at 1am is still fixable at 1:05am.
export async function fetchTodaysOrders() {
  const { from, to } = tradingDayRange(tradingTodayISO())
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, total_amount, payment_method, status')
    .eq('status', 'paid')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data ?? []
}

// Switch a paid order between cash and card via the
// correct_order_payment_method RPC: atomic update + audit row, guarded
// server-side (same trading day, day not closed, cash<->card only).
// Returns the old method. Throws on error.
export async function correctOrderPaymentMethod(order_id, new_method, staff_id) {
  const { data, error } = await supabase.rpc('correct_order_payment_method', {
    p_order_id: order_id,
    p_new_method: new_method,
    p_staff_id: staff_id ?? null,
  })
  if (error) throw error
  return data
}

// Save an order atomically online, falling back to the offline queue.
// NEVER throws — the till must not get stuck because a save failed; the
// caller proceeds to print and clear the cart regardless.
//
// Returns how the order was saved so the caller can pick the right toast:
//   'online'   — RPC committed the order
//   'offline'  — device offline, queued for sync
//   'fallback' — online save failed, queued for sync
//   'failed'   — both the RPC and the offline queue failed
export async function saveOrder(order, items, isOnline) {
  if (isOnline) {
    try {
      await createOrderWithItems(order, items)
      return 'online'
    } catch (err) {
      console.error('Order save failed:', err)
      try {
        await db.pendingOrders.add({ order, items })
        return 'fallback'
      } catch (queueErr) {
        console.error('Offline queue also failed:', queueErr)
        return 'failed'
      }
    }
  }
  try {
    await db.pendingOrders.add({ order, items })
    return 'offline'
  } catch (err) {
    console.error('Offline queue failed:', err)
    return 'failed'
  }
}
