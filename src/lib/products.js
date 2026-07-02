import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'
import { getTillId } from './till'
import { newClientId } from './clientId'
import { refreshPendingCount } from './pendingCount'

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
    // .filter(), NOT .where('active') — `active` is a boolean and IndexedDB
    // cannot index boolean keys, so an index lookup matches nothing and the
    // offline till renders an empty product grid.
    return db.products.filter(p => p.active).sortBy('name')
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
  // Client-generated id = idempotency key: if a sync inserts the row but
  // crashes before deleting the queue entry, the replay upserts with the
  // same id and no-ops instead of double-applying the stock change.
  const movement = { id: newClientId(), product_id, type, quantity, notes, till_id, created_at: new Date().toISOString() }
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { error } = await supabase.from('stock_movements').insert(movement)
    if (error) throw error
  } else {
    await db.pendingStockMovements.add(movement)
    // Fire-and-forget: the badge refresh must never block or fail the log.
    refreshPendingCount().catch(() => {})
  }
}
