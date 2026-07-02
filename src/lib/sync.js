import { supabase } from './supabase'
import { db } from './db'
import { createOrderWithItems } from './orders'
import { finalizeStocktake } from './stocktakes'
import { refreshPendingCount } from './pendingCount'
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
    // supabase-js RETURNS { error }, it does not throw — the error must be
    // checked explicitly or a failed insert still falls through to the
    // queue delete and the movement (plus its trigger-applied stock change)
    // is lost forever.
    //
    // Upsert with ignoreDuplicates makes a replay a no-op when a previous
    // sync inserted the row but crashed before deleting the queue entry:
    // movements carry a client-generated id (see logStockMovement), the
    // same idempotency scheme orders use. Entries queued before ids were
    // added have no id and insert with the column default, which never
    // conflicts.
    const { error } = await supabase
      .from('stock_movements')
      .upsert(movement, { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      console.error('Failed to sync stock movement', error)
      break
    }
    try {
      await db.pendingStockMovements.delete(localId)
    } catch (err) {
      // The row reached the DB; the queue entry will replay next drain and
      // no-op thanks to the client id. Don't let the loop throw.
      console.error('Failed to clear synced stock movement', err)
      break
    }
  }
}

export async function syncPendingStocktakes() {
  const pending = await db.pendingStocktakes.toArray()
  for (const item of pending) {
    const { localId, stocktake, lines } = item
    try {
      // Atomic RPC; the stocktake carries its client-generated id, so a
      // replay after a crash between RPC and queue-delete is a server-side
      // no-op (ON CONFLICT DO NOTHING on stocktakes.id) — stock is never
      // re-baselined twice.
      await finalizeStocktake(stocktake, lines)
      await db.pendingStocktakes.delete(localId)
    } catch (err) {
      console.error('Failed to sync stocktake', err)
      break
    }
  }
}

// Single-flight guard: the 'online' event, the startup drain and any manual
// trigger can fire together (StrictMode remounts, connectivity flaps); two
// concurrent drains would replay the same queue entries in parallel.
let syncInFlight = null

export function syncAll() {
  if (!syncInFlight) {
    syncInFlight = (async () => {
      try {
        await syncPendingOrders()
        await syncPendingStockMovements()
        await syncPendingStocktakes()
      } finally {
        syncInFlight = null
        await refreshPendingCount()
      }
    })()
  }
  return syncInFlight
}

// Guard against double registration — Layout's effect can run more than once
// (StrictMode double-mount in dev, Layout remounts) and duplicate listeners
// mean duplicate sync runs on every 'online' event.
let listenersInitialized = false

export function initConnectivityListener() {
  if (listenersInitialized) return
  listenersInitialized = true

  const { setOnline } = useSyncStore.getState()

  window.addEventListener('online', () => {
    setOnline(true)
    syncAll().catch(err => console.error('Sync failed', err))
  })

  window.addEventListener('offline', () => {
    setOnline(false)
  })

  // Startup drain: a queue entry left by a 'fallback' save (transient server
  // error while online) or by a reload while offline never sees an
  // offline→online transition, so without this it sits in IndexedDB
  // indefinitely — and pendingCount stays 0, so the StatusBar badge lies.
  if (navigator.onLine) {
    syncAll().catch(err => console.error('Startup sync failed', err))
  } else {
    refreshPendingCount().catch(() => {})
  }
}
