// fetch wrapper for the Supabase client: adds the two audit headers to
// DATABASE requests (/rest/v1/...) and to nothing else.
//
//   x-staff-session  the signed-in staff member's session token
//   x-app-build      which bundle this is
//
// Two safety rules, both about never breaking the till:
//
// 1. Database requests only. Edge functions each hard-code the headers
//    their CORS preflight allows; an extra header on functions.invoke would
//    make the browser refuse the call (and verify-pin with it).
//
// 2. Off until proven. A custom header makes the browser send a CORS
//    preflight; if the gateway ever refused it, EVERY database request
//    would fail. So nothing is attached until probeAuditHeaders() has made
//    one real request carrying both headers and got an HTTP answer back.
//    Until then, and if the probe never succeeds, requests go out exactly
//    as they always have and the log falls back to weaker attribution.

import { APP_BUILD } from './build'
import { getStaffToken } from './staffSession'

let headersEnabled = false

export function auditHeadersEnabled() {
  return headersEnabled
}

/** Test seam; production code flips this only through probeAuditHeaders. */
export function setAuditHeadersEnabled(value) {
  headersEnabled = !!value
}

function isDatabaseRequest(input) {
  try {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    return new URL(url, globalThis.location?.href ?? 'http://localhost').pathname.startsWith('/rest/v1/')
  } catch {
    return false
  }
}

export function auditFetch(input, init) {
  let nextInit = init
  try {
    if (headersEnabled && isDatabaseRequest(input)) {
      const headers = new Headers(init?.headers ?? (typeof input === 'object' ? input?.headers : undefined) ?? undefined)
      headers.set('x-app-build', APP_BUILD)
      const token = getStaffToken()
      if (token) headers.set('x-staff-session', token)
      nextInit = { ...(init ?? {}), headers }
    }
  } catch {
    nextInit = init // header plumbing must never be why a request fails
  }
  return fetch(input, nextInit)
}

/**
 * One real request carrying both headers. Any HTTP response (even a 404
 * from a database that has no audit_ping yet, or a 401) proves the gateway
 * lets the headers through, and they are switched on. A thrown error means
 * offline or a refused preflight — indistinguishable from here — so the
 * headers stay off and the caller retries later.
 *
 * @returns {Promise<boolean>} whether the headers are now enabled
 */
export async function probeAuditHeaders({ url, anonKey, accessToken } = {}) {
  if (headersEnabled) return true
  if (!url || !anonKey) return false
  try {
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/audit_ping`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
        'Content-Type': 'application/json',
        'x-app-build': APP_BUILD,
        'x-staff-session': 'probe',
      },
      body: '{}',
    })
    headersEnabled = true
  } catch {
    headersEnabled = false
  }
  return headersEnabled
}
