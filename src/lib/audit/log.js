// logEvent — record something that happened at the till and writes no row.
//
//   logEvent('cart.line_removed', { product: 'Guinness', quantity: 2, value: 14.80 }, { severity: 1 })
//
// Row changes (sales, price edits, tab payments ...) are captured by the
// database itself and need nothing from the client. This is for the rest:
// a line taken off an order before payment, the drawer opened without a
// sale, a report exported, a setting changed, the till going offline.
//
// RULES FOR CALLERS
//   - It never throws and never needs awaiting. Call it and carry on; it
//     must not be able to delay or fail whatever the member of staff is doing.
//   - type: lower-case dotted, "<area>.<what_happened>" in the past tense
//     (cart.line_removed, drawer.opened_no_sale). The server rejects
//     anything not matching ^[a-z][a-z0-9_.]{1,79}$.
//   - detail: small, plain JSON. Amounts as numbers, names as shown on
//     screen. NEVER a PIN, a token, a password or a whole member record.
//   - severity: 0 routine (default) · 1 notable · 2 needs a look.
//
// The server stamps the till and its own clock, and checks the staff
// session id against its own records, so the till's claims here are
// evidence, not authority.

import { getStaffSessionId } from './staffSession'
import { createOutbox, dexieStore, memoryStore } from './outbox'
import { useSessionStore } from '../../stores/sessionStore'
import { getTillId } from '../till'

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // randomUUID needs a secure context; the till can be served over plain
  // http on the pub LAN, where only getRandomValues exists.
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function send(events) {
  // Imported lazily so that logging an event never drags the Supabase
  // client into a module (or a test) that otherwise would not load it.
  const { supabase } = await import('../supabase')
  const { data, error } = await supabase.rpc('audit_log_events', { p_events: events })
  if (error) throw error
  return data
}

let outbox = null
let soonTimer = null

function getOutbox() {
  if (!outbox) {
    let store
    try { store = dexieStore() } catch { store = memoryStore() }
    outbox = createOutbox({ store, send, isOnline: () => globalThis.navigator?.onLine !== false })
  }
  return outbox
}

/** Test seam: swap the queue (pass null to rebuild the default one). */
export function __setOutbox(next) {
  outbox = next
}

export function logEvent(type, detail = {}, { severity = 0 } = {}) {
  try {
    const box = getOutbox()
    const staff = useSessionStore.getState().activeStaff
    const dropped = box.takeDropped?.() ?? 0
    const event = {
      id: uuid(),
      type,
      at: new Date().toISOString(),
      severity,
      session_id: getStaffSessionId(),
      staff_id: staff?.id ?? null,
      detail: {
        ...detail,
        till: getTillId(),
        page: globalThis.location?.pathname ?? null,
        ...(dropped > 0 ? { events_dropped_before_this: dropped } : {}),
      },
    }
    box.enqueue(event).catch(() => {})
    // Anything notable goes out within a couple of seconds rather than
    // waiting for the timer.
    if (severity >= 1 && !soonTimer) {
      soonTimer = setTimeout(() => { soonTimer = null; flushEvents() }, 1500)
    }
  } catch {
    // logging must never be the reason something else fails
  }
}

/** Send queued events now. Never rejects. */
export function flushEvents() {
  try {
    return getOutbox().flush().catch(() => 0)
  } catch {
    return Promise.resolve(0)
  }
}

export function pendingEvents() {
  try {
    return getOutbox().pending().catch(() => 0)
  } catch {
    return Promise.resolve(0)
  }
}
