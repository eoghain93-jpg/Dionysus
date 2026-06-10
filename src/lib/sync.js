import { supabase } from './supabase'
import { db } from './db'
import { createOrderWithItems } from './orders'
import { useSyncStore } from '../stores/syncStore'

export async function syncPendingOrders() {
  const pending = await db.pendingOrders.toArray()
  if (pending.length === 0) return

  for (const item of pending) {
    const { localId, order, items } = item
    try {
      // One atomic RPC: order + items + sale stock movements + tab balance.
      // The order carries its client-generated id, so if a previous sync got
      // the order in but crashed before deleting the queue entry, this
      // replay is a no-op server-side (ON CONFLICT DO NOTHING).
      await createOrderWithItems(order, items)
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
  const { setPendingCount } = useSyncStore.getState()
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
