// Price change log.
//
// Rows are written ONLY by the products_log_price_change database trigger
// (migration 20261122120000) — every change to a product's standard or
// member price lands here whatever made it, so there is nothing to call
// from the client when saving a product. This module just reads the log.
import { supabase } from './supabase'

/**
 * Most recent price changes, newest first. Opening entries (the row logged
 * when a product is first created, or the baseline taken when logging
 * began) have no "old" price and are left out — this is the list of prices
 * that CHANGED.
 */
export async function fetchPriceChanges(limit = 100) {
  const { data, error } = await supabase
    .from('product_price_changes')
    .select('id, changed_at, till_id, old_standard_price, new_standard_price, old_member_price, new_member_price, product:products(name), staff:members(name)')
    .not('old_standard_price', 'is', null)
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}
