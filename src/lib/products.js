import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'

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

export async function logStockMovement({ product_id, type, quantity, notes, till_id = 'till-1' }) {
  const movement = { product_id, type, quantity, notes, till_id, created_at: new Date().toISOString() }
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { error } = await supabase.from('stock_movements').insert(movement)
    if (error) throw error
    const sign = (type === 'sale' || type === 'wastage' || type === 'spillage') ? -1 : 1
    await supabase.rpc('adjust_stock', { p_product_id: product_id, p_delta: sign * quantity })
  } else {
    await db.pendingStockMovements.add(movement)
  }
}
