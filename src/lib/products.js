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
  const write = f => (id
    ? supabase.from('products').update(f).eq('id', id).select().single()
    : supabase.from('products').insert(f).select().single())

  let { data, error } = await write(fields)
  // Bundle ahead of the database update: products has no changed_by column
  // yet, and the whole save is refused (nothing was written). Save without
  // it rather than block a price change; who changed it is then not
  // recorded, exactly as before the update.
  if (error && 'changed_by' in fields
      && (error.code === 'PGRST204' || error.code === '42703' || /changed_by/i.test(error.message ?? ''))) {
    const { changed_by: _changedBy, ...rest } = fields
    ;({ data, error } = await write(rest))
  }
  if (error) throw error
  await db.products.put(data)
  return data
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
