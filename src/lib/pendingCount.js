import { db } from './db'
import { useSyncStore } from '../stores/syncStore'

// StatusBar's pending badge. Always recount from IndexedDB (two cheap
// count() calls) rather than increment/decrement in the store — counter
// deltas drift the moment a queue write and a sync drain race.
export async function refreshPendingCount() {
  const count =
    (await db.pendingOrders.count()) +
    (await db.pendingStockMovements.count()) +
    (await db.pendingStocktakes.count())
  useSyncStore.getState().setPendingCount(count)
}
