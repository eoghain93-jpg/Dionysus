import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'
import { getTillId } from './till'

export async function fetchProducts() {
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { data, error } = await supabase
      .from('products')
      .select('*, suppliers(name)')
      .eq('active', true)
      .order('category')
      .order('name')

    if (error) throw error

    await db.products.bulkPut(data)
    return data
  } else {
    return db.products.where('active').equals(1).sortBy('name')
  }
}

export async function upsertProduct(product) {
  const { id, ...fields } = product
  if (id) {
    const { data, error } = await supabase.from('products').update(fields).eq('id', id).select().single()
    if (error) throw error
    await db.products.put(data)
    return data
  } else {
    const { data, error } = await supabase.from('products').insert(fields).select().single()
    if (error) throw error
    await db.products.put(data)
    return data
  }
}

export async function logStockMovement({ product_id, type, quantity, notes, till_id = getTillId() }) {
  // DB trigger apply_stock_movement (migration 20260527150000) updates
  // products.stock_quantity automatically from the inserted row's type +
  // quantity, so we no longer call adjust_stock from the client. This makes
  // online + offline-synced movements use the same code path and removes
  // the risk of inserting a movement without a matching stock update.
  const movement = { product_id, type, quantity, notes, till_id, created_at: new Date().toISOString() }
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { error } = await supabase.from('stock_movements').insert(movement)
    if (error) throw error
  } else {
    await db.pendingStockMovements.add(movement)
  }
}

// Bulk insert sale-type stock movements for an order's items. Called after
// a successful checkout so stock_quantity decrements per pint / bottle /
// measure sold. If offline (or the bulk insert fails), the movements are
// queued individually for sync.
export async function logSaleMovements(items, till_id = getTillId()) {
  if (!items?.length) return
  const movements = items.map(i => ({
    product_id: i.product_id,
    type: 'sale',
    quantity: i.quantity,
    till_id,
    created_at: new Date().toISOString(),
  }))
  const { isOnline } = useSyncStore.getState()
  if (isOnline) {
    const { error } = await supabase.from('stock_movements').insert(movements)
    if (!error) return
    // Insert failed mid-checkout (network blip) — queue per-row for sync.
  }
  await db.pendingStockMovements.bulkAdd(movements)
}
