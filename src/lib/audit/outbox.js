// Offline-safe queue for audit events.
//
// Events are written to their own IndexedDB database first and sent to the
// server in batches, so nothing is lost to a reload, a dropped connection
// or an offline shift. Each event has a client-generated id and the server
// ignores ids it has already stored, so a batch re-sent after a failure is
// never recorded twice.
//
// A SEPARATE database from the sales queue ('ClubEPOS') on purpose: adding
// a table there means a schema upgrade on the database that holds unsynced
// sales, and a blocked upgrade there costs money.
//
// Nothing in here throws to its caller. If IndexedDB is unavailable the
// queue falls back to memory for the life of the page.

import Dexie from 'dexie'

export const MAX_QUEUED = 5000
export const BATCH_SIZE = 100

export function memoryStore() {
  const rows = new Map()
  return {
    async add(event) { rows.set(event.id, event) },
    async oldest(n) {
      return [...rows.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(0, n)
    },
    async remove(ids) { ids.forEach(id => rows.delete(id)) },
    async count() { return rows.size },
  }
}

export function dexieStore() {
  const db = new Dexie('DionysusAudit')
  db.version(1).stores({ events: 'id, at' })
  return {
    add: event => db.events.put(event),
    oldest: n => db.events.orderBy('at').limit(n).toArray(),
    remove: ids => db.events.bulkDelete(ids),
    count: () => db.events.count(),
  }
}

/**
 * @param {object} deps
 * @param {object} deps.store     add / oldest / remove / count (see memoryStore)
 * @param {(events: object[]) => Promise<unknown>} deps.send  throws on failure
 * @param {() => boolean} [deps.isOnline]
 * @param {() => number} [deps.now]
 */
export function createOutbox({ store, send, isOnline = () => true, now = () => Date.now() }) {
  let fallback = null // memory queue, used only once the durable one has failed
  let inFlight = null
  let failures = 0
  let retryAt = 0
  let dropped = 0

  async function trim(target) {
    const over = (await target.count()) - MAX_QUEUED
    if (over > 0) {
      const oldest = await target.oldest(over)
      await target.remove(oldest.map(e => e.id))
      dropped += oldest.length
    }
  }

  async function enqueue(event) {
    try {
      await store.add(event)
      await trim(store)
    } catch {
      try {
        fallback ??= memoryStore()
        await fallback.add(event)
        await trim(fallback)
      } catch { /* nowhere left to put it */ }
    }
  }

  async function drain(target) {
    let sent = 0
    // Bounded: one flush moves at most 20 batches, the timer picks up the rest.
    for (let i = 0; i < 20; i++) {
      const batch = await target.oldest(BATCH_SIZE)
      if (batch.length === 0) break
      await send(batch)
      // Remove everything that was delivered, including events the server
      // rejected as malformed — re-sending those would fail the same way.
      await target.remove(batch.map(e => e.id))
      sent += batch.length
      if (batch.length < BATCH_SIZE) break
    }
    return sent
  }

  /** Send what is queued. Resolves with how many events were delivered. */
  function flush() {
    if (inFlight) return inFlight
    if (!isOnline() || now() < retryAt) return Promise.resolve(0)
    inFlight = (async () => {
      let sent = 0
      try {
        try {
          sent += await drain(store)
        } catch (err) {
          // The durable queue could not be read or sent. Whatever fell
          // back to memory must still get its turn before giving up.
          if (!fallback) throw err
          sent += await drain(fallback)
          throw err
        }
        if (fallback) sent += await drain(fallback)
        failures = 0
      } catch (err) {
        failures += 1
        // The database has no audit_log_events yet (new bundle, old
        // database): keep everything and look again in five minutes.
        const missing = err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')
        retryAt = now() + (missing ? 5 * 60_000 : Math.min(5 * 60_000, 5_000 * 2 ** Math.min(failures, 6)))
      } finally {
        inFlight = null
      }
      return sent
    })()
    return inFlight
  }

  async function pending() {
    let n = 0
    try { n += await store.count() } catch { /* durable queue unavailable */ }
    if (fallback) n += await fallback.count()
    return n
  }

  /** Events discarded because the queue was full; reading resets the count. */
  function takeDropped() {
    const n = dropped
    dropped = 0
    return n
  }

  return { enqueue, flush, pending, takeDropped }
}
