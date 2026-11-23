// Offline replay: sales and stock movements rung while the till could not
// reach the database are queued in IndexedDB (see orders.js saveOrder,
// products.js logStockMovement) and sent from here.
//
// The queue is replayed at start-up, when the browser comes back online and
// every minute while online — a sale that fell back to the queue because one
// request failed must not wait for the next offline spell to be sent.

import { supabase } from './supabase'
import { db } from './db'
import { createOrderWithItems } from './orders'
import { useSyncStore } from '../stores/syncStore'
import { logEvent } from './audit/log'

const REPLAY_EVERY_MS = 60_000
// A sale that the server keeps refusing fails again on every pass. Say so
// in the audit log when it starts and when the reason changes, then only
// this often — not once a minute for as long as it sits there.
const REPEAT_FAILURE_AFTER_MS = 30 * 60_000

function errorMessage(err) {
  return String(err?.message ?? err ?? 'unknown').slice(0, 300)
}

/**
 * Send every queued order. Orders are independent and the RPC is idempotent
 * (each carries its client-generated id), so one that fails stays queued
 * and the rest still go: a single bad order can no longer hold back every
 * sale rung after it.
 *
 * @returns {Promise<{ sent: number, failed: number, error: unknown, failedId?: string }>}
 */
export async function syncPendingOrders() {
  const result = { sent: 0, failed: 0, error: null }
  const pending = await db.pendingOrders.toArray()

  for (const item of pending) {
    const { localId, order, items } = item
    try {
      // One atomic RPC: order + items + sale stock movements + tab balance.
      // The order carries its client-generated id, so if a previous sync got
      // the order in but crashed before deleting the queue entry, this
      // replay is a no-op server-side (ON CONFLICT DO NOTHING).
      await createOrderWithItems(order, items)
      await db.pendingOrders.delete(localId)
      result.sent += 1
    } catch (err) {
      console.error('Failed to sync order', err)
      result.failed += 1
      if (result.failed === 1) {
        result.error = err
        result.failedId = order?.id
      }
      // The connection has gone again: every remaining order would fail the
      // same way. They all stay queued for the next pass.
      if (globalThis.navigator?.onLine === false) break
    }
  }
  return result
}

/**
 * Send queued stock movements (wastage, staff drinks ... recorded offline).
 * supabase-js reports a refused insert as { error } rather than throwing, so
 * the error must be checked: a movement is only taken off the queue once the
 * database has it. A refused movement stays queued and the rest still go
 * (movements are independent of each other) — one the server will never
 * accept, such as wastage for a product since removed, must not hold back
 * every record made after it.
 *
 * @returns {Promise<{ sent: number, failed: number, error: unknown }>}
 */
export async function syncPendingStockMovements() {
  const result = { sent: 0, failed: 0, error: null }
  const pending = await db.pendingStockMovements.toArray()

  for (const item of pending) {
    const { localId, ...movement } = item
    try {
      const { error } = await supabase.from('stock_movements').insert(movement)
      if (error) throw error
      await db.pendingStockMovements.delete(localId)
      result.sent += 1
    } catch (err) {
      console.error('Failed to sync stock movement', err)
      result.failed += 1
      if (result.failed === 1) result.error = err
      // The connection has gone again: the rest would fail the same way.
      if (globalThis.navigator?.onLine === false) break
    }
  }
  return result
}

async function refreshPendingCount() {
  try {
    const remaining = (await db.pendingOrders.count()) + (await db.pendingStockMovements.count())
    useSyncStore.getState().setPendingCount(remaining)
  } catch {
    // the count is only for the status bar
  }
}

// kind -> { message, at } of the failure last reported to the audit log
const lastReported = {}

// At most one 'sync.failed' per replay pass per kind, and not the same
// failure over and over (see REPEAT_FAILURE_AFTER_MS).
function reportFailure(what, result) {
  if (!result.failed) {
    delete lastReported[what]
    return
  }
  const message = errorMessage(result.error)
  const previous = lastReported[what]
  const now = Date.now()
  if (previous && previous.message === message && now - previous.at < REPEAT_FAILURE_AFTER_MS) return
  lastReported[what] = { message, at: now }
  logEvent('sync.failed', {
    what,
    message,
    count: result.failed,
    ...(result.failedId ? { order_id: result.failedId } : {}),
  }, { severity: 1 })
}

async function replay() {
  let orders
  let movements
  try {
    orders = await syncPendingOrders()
  } catch (err) {
    orders = { sent: 0, failed: 1, error: err } // the queue itself could not be read
  }
  try {
    movements = await syncPendingStockMovements()
  } catch (err) {
    movements = { sent: 0, failed: 1, error: err }
  }

  if (orders.sent + movements.sent > 0) {
    logEvent('sync.replayed', { orders: orders.sent, stock_movements: movements.sent }, { severity: 1 })
  }
  reportFailure('order', orders)
  reportFailure('stock_movement', movements)

  await refreshPendingCount()
}

// The queue lives in IndexedDB, which every tab of this till shares. Where
// the browser has the Web Locks API (https only) a pass in one tab keeps the
// others out; elsewhere the guard is per tab, as it always was.
const REPLAY_LOCK = 'club-epos-offline-replay'

async function replayExclusive() {
  const locks = globalThis.navigator?.locks
  if (typeof locks?.request !== 'function') return replay()

  let started = false
  try {
    await locks.request(REPLAY_LOCK, { ifAvailable: true }, async (lock) => {
      started = true
      // Another tab is replaying right now: leave the sending to it.
      if (lock) await replay()
      else await refreshPendingCount()
    })
  } catch (err) {
    // The lock itself was refused: replay without it rather than not at all.
    if (!started) return replay()
    throw err
  }
}

let running = null

/**
 * Replay both queues, then set the status bar's pending count to whatever
 * is still queued. Never rejects.
 *
 * Two replays never overlap: a second call while one is running joins it.
 * (Overlapping passes would both read the same queue and send every stock
 * movement twice.)
 */
export function syncAll() {
  if (!running) {
    running = replayExclusive()
      .catch(err => console.error('Sync failed', err))
      .finally(() => { running = null })
  }
  return running
}

let stop = null

/**
 * Start following the connection and replaying the queue: once now, on
 * every 'online' event, and every minute while online. Safe to call more
 * than once — only one set of listeners and one interval ever exists.
 *
 * @returns {() => void} stop (removes the listeners and the interval)
 */
export function initConnectivityListener() {
  if (stop) return stop

  const { setOnline } = useSyncStore.getState()

  const onOnline = async () => {
    setOnline(true)
    await syncAll()
  }
  const onOffline = () => {
    setOnline(false)
  }
  // Offline there is nothing to send, but the status bar should still say
  // how much is waiting.
  const tick = () => {
    if (globalThis.navigator?.onLine === false) refreshPendingCount()
    else syncAll()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  const interval = setInterval(tick, REPLAY_EVERY_MS)
  tick()

  const stopThis = () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    clearInterval(interval)
    if (stop === stopThis) stop = null
  }
  stop = stopThis
  return stop
}
