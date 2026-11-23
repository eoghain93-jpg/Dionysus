// Sales-history shortcuts for the till: the "Popular" tab (what the bar sells
// most) and a member's "usual" (what that member orders most).
import { supabase } from './supabase'
import { fetchAllPages } from './fetchAllPages'
import { useSyncStore } from '../stores/syncStore'

const POPULAR_CACHE_KEY = 'till-popular-products'
const POPULAR_WINDOW_DAYS = 7
const POPULAR_MAX_AGE_MS = 6 * 60 * 60 * 1000
// More than any till shows at once: the Popular tab trims this to what fits
// its screen without scrolling.
const POPULAR_LIMIT = 30

/**
 * Product ids ranked by units sold, best seller first.
 * Pure: rows are order_items ({ product_id, quantity }).
 */
export function rankPopular(rows, limit = POPULAR_LIMIT) {
  const sold = new Map()
  for (const row of rows ?? []) {
    if (!row.product_id) continue
    sold.set(row.product_id, (sold.get(row.product_id) ?? 0) + Number(row.quantity ?? 0))
  }
  return [...sold.entries()]
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

function readPopularCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(POPULAR_CACHE_KEY))
    return Array.isArray(cached?.ids) ? cached : null
  } catch {
    return null
  }
}

/**
 * Best-selling product ids over the last week. Cached on the device so the
 * tab still works offline and the till doesn't re-count sales on every visit.
 * Returns [] when there is no history to go on — the till then opens on "All".
 */
export async function fetchPopularProductIds(now = new Date()) {
  const cached = readPopularCache()
  const fresh = cached && now.getTime() - cached.at < POPULAR_MAX_AGE_MS
  if (fresh || !useSyncStore.getState().isOnline) return cached?.ids ?? []

  try {
    const since = new Date(now.getTime() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const rows = await fetchAllPages(() => supabase
      .from('order_items')
      .select('id, product_id, quantity')
      .gte('created_at', since))
    const ids = rankPopular(rows)
    localStorage.setItem(POPULAR_CACHE_KEY, JSON.stringify({ ids, at: now.getTime() }))
    return ids
  } catch (err) {
    console.error('Failed to load popular products:', err)
    return cached?.ids ?? []
  }
}

/**
 * A member's usual order from their recent order lines: the products that
 * turn up in the most of their orders, each at the quantity they most often
 * buy. A product has to appear in at least two orders to count as a habit.
 * Pure: rows are order_items ({ order_id, product_id, quantity }).
 */
export function usualFromItems(rows, maxProducts = 2) {
  const byProduct = new Map()
  for (const row of rows ?? []) {
    if (!row.product_id || row.staff_credit_for) continue
    const entry = byProduct.get(row.product_id) ?? { orders: new Map() }
    entry.orders.set(row.order_id, (entry.orders.get(row.order_id) ?? 0) + Number(row.quantity ?? 0))
    byProduct.set(row.product_id, entry)
  }

  return [...byProduct.entries()]
    .map(([product_id, { orders }]) => {
      const counts = new Map()
      for (const qty of orders.values()) counts.set(qty, (counts.get(qty) ?? 0) + 1)
      // Most common quantity; the smaller one wins a tie.
      const [quantity] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
      return { product_id, quantity, orderCount: orders.size }
    })
    .filter(u => u.orderCount >= 2 && u.quantity > 0)
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, maxProducts)
    .map(({ product_id, quantity }) => ({ product_id, quantity }))
}

/**
 * The member's usual, from their last 20 sales. Online only — offline, or on
 * any error, there is simply no suggestion.
 */
export async function fetchMemberUsual(memberId) {
  if (!memberId || !useSyncStore.getState().isOnline) return []
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id')
      .eq('member_id', memberId)
      .eq('status', 'paid')
      .eq('is_tab_settlement', false)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    if (!orders?.length) return []

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('order_id, product_id, quantity, staff_credit_for')
      .in('order_id', orders.map(o => o.id))
    if (itemsError) throw itemsError
    return usualFromItems(items)
  } catch (err) {
    console.error('Failed to load member usual:', err)
    return []
  }
}
