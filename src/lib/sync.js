import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'

export async function syncPendingOrders() {
  const pending = await db.pendingOrders.toArray()
  if (pending.length === 0) return

  for (const item of pending) {
    const { localId, ...order } = item
    try {
      const { data: orderData, error } = await supabase
        .from('orders')
        .insert(order.order)
        .select()
        .single()
      if (error) throw error

      const itemsWithOrderId = order.items.map(i => ({ ...i, order_id: orderData.id }))
      await supabase.from('order_items').insert(itemsWithOrderId)

      // Decrement stock for each item — DB trigger updates stock_quantity.
      // Done at sync-time (not queue-time) so the movement timestamp matches
      // when the sale actually landed in the canonical store.
      const movements = order.items
        .filter(i => i.product_id)
        .map(i => ({
          product_id: i.product_id,
          type: 'sale',
          quantity: i.quantity,
          till_id: order.order.till_id ?? null,
          created_at: order.order.created_at,
        }))
      if (movements.length > 0) {
        await supabase.from('stock_movements').insert(movements)
      }

      await db.pendingOrders.delete(localId)
    } catch (err) {
      console.error('Failed to sync order', err)
      break
    }
  }
}

export async function syncPendingStockMovements() {
  const pending = await db.pendingStockMovements.toArray()
  for (const item of pending) {
    const { localId, ...movement } = item
    try {
      await supabase.from('stock_movements').insert(movement)
      await db.pendingStockMovements.delete(localId)
    } catch (err) {
      console.error('Failed to sync stock movement', err)
      break
    }
  }
}

export async function syncAll() {
  const { setOnline, setPendingCount } = useSyncStore.getState()
  await syncPendingOrders()
  await syncPendingStockMovements()
  const remaining = (await db.pendingOrders.count()) + (await db.pendingStockMovements.count())
  setPendingCount(remaining)
}

export function initConnectivityListener() {
  const { setOnline } = useSyncStore.getState()

  window.addEventListener('online', async () => {
    setOnline(true)
    await syncAll()
  })

  window.addEventListener('offline', () => {
    setOnline(false)
  })
}
