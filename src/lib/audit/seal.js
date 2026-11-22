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
    if (data.match === false) {
      logEvent('integrity.seal_mismatch_seen', { remembered: mine?.code ?? null }, { severity: 2 })
    }
    if (data.head) {
      // Only ever move forwards: a server that answers with an OLDER seal
      // than the one we hold must not overwrite our evidence.
      if (!mine || data.match !== false || data.head.id > mine.id) {
        globalThis.localStorage?.setItem(KEY, JSON.stringify({
          id: data.head.id, hash: data.head.hash, code: data.head.code, at: data.head.sealed_at,
        }))
      }
    }
    return data.head ?? null
  } catch {
    return null
  }
}
