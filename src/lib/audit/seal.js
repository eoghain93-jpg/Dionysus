// Each till keeps its own copy of the newest audit seal it has been shown.
//
// The audit log is hash-sealed every few minutes (see the audit migration).
// Someone with full database access could, in principle, rewrite history
// and re-seal it — but they cannot reach into this till's storage. So each
// time the till checks in it tells the server which seal it remembers; if
// the server no longer has that exact seal, history was rewritten (or the
// database was restored) and the server records a serious alert.
//
// The remembered seal's short code is also what Close Day puts in the
// Z-report email subject: a second copy, in an inbox, outside the database.

import { supabase } from '../supabase'
import { logEvent } from './log'

const KEY = 'audit_seal'
const DISPUTED_KEY = 'audit_seal_disputed'
const MAX_DISPUTED = 10

/** @returns {{ id: number, hash: string, code: string, at: string } | null} */
export function rememberedSeal() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const seal = raw ? JSON.parse(raw) : null
    return seal && seal.id && seal.hash ? seal : null
  } catch {
    return null
  }
}

/**
 * Seals this till once held that the database later no longer had: the
 * till's own evidence that history changed underneath it. Kept until
 * someone clears the till's storage; shown on the Log page.
 * @returns {{ id: number, hash: string, code: string, at: string, noticed_at: string }[]}
 */
export function disputedSeals() {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(DISPUTED_KEY) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function keepAsDisputed(seal) {
  try {
    const list = disputedSeals()
    if (list.some(d => d.id === seal.id && d.hash === seal.hash)) return
    list.push({ ...seal, noticed_at: new Date().toISOString() })
    globalThis.localStorage?.setItem(DISPUTED_KEY, JSON.stringify(list.slice(-MAX_DISPUTED)))
  } catch { /* storage full or unavailable */ }
}

/**
 * Compare this till's remembered seal with the server and remember the
 * newest one. Never throws. Resolves with the server's newest seal, or
 * null when it could not be reached (offline, old database).
 */
export async function witnessSeal() {
  try {
    const mine = rememberedSeal()
    const { data, error } = await supabase.rpc('audit_seal_witness', {
      p_seal_id: mine?.id ?? null,
      p_hash: mine?.hash ?? null,
    })
    if (error || !data) return null
    if (data.match === false && mine) {
      // The database no longer has the seal this till was shown. Keep our
      // copy aside FIRST — it is the evidence — and only then follow the
      // database's current chain (so this is raised once, not on every
      // check-in for ever after a legitimate restore).
      keepAsDisputed(mine)
      logEvent('integrity.seal_mismatch_seen', { remembered: mine.code ?? null, remembered_seal: mine.id }, { severity: 2 })
    }
    if (data.head) {
      globalThis.localStorage?.setItem(KEY, JSON.stringify({
        id: data.head.id, hash: data.head.hash, code: data.head.code, at: data.head.sealed_at,
      }))
    }
    return data.head ?? null
  } catch {
    return null
  }
}
