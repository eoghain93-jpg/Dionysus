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
