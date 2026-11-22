// Staff sign-in and PIN checks.
//
// The database checks the PIN itself (staff_sign_in / staff_verify_pin /
// staff_set_pin) and, on sign-in, opens a server-side session whose token
// then travels with every request — that is what lets the audit log say
// who did something with confidence.
//
// Every function falls back to the legacy verify-pin edge function when
// the database call is unavailable (a till on the new bundle before the
// migration has landed, or a PIN hash the database cannot read), so signing
// in can never be broken by the audit layer. After a fallback sign-in the
// session is registered as "claimed": still attributed, but the log says
// the database did not check the PIN itself.
//
// All three return the same shapes verify-pin always has, so the PIN
// screens did not need new logic:
//   { valid: true, member: { id, name } }
//   { valid: false }                                    wrong PIN / unknown
//   { valid: false, attemptsRemaining: n }
//   { valid: false, reason: 'no_pin' }                  no PIN set yet
//   { valid: false, reason: 'locked', retryAfterSeconds: n }

import { supabase } from '../supabase'
import { setStaffSession, clearStaffSession, getStaffSession } from './staffSession'

async function legacyVerify(memberId, pin) {
  const { data, error } = await supabase.functions.invoke('verify-pin', {
    body: { member_id: memberId, pin },
  })
  if (error || !data) throw error ?? new Error('PIN check failed')
  return data
}

/**
 * Sign a staff member in. Resolves with the verify-pin response shape;
 * rejects only when neither the database nor verify-pin could be reached.
 */
export async function signInStaff(memberId, pin) {
  try {
    const { data, error } = await supabase.rpc('staff_sign_in', { p_member_id: memberId, p_pin: pin })
    if (error || !data) throw error ?? new Error('no response')
    if (data.valid && data.session) {
      setStaffSession({ id: data.session.id, token: data.session.token, staffId: memberId, trust: 'pin' })
    }
    return data
  } catch {
    const data = await legacyVerify(memberId, pin)
    if (data.valid) {
      // The person is signed in on this till whatever happens next; what
      // follows only decides how well the server can attribute their work.
      clearStaffSession()
      try {
        // The first attempt may have failed for a passing reason (a blip,
        // a cold start). The PIN is now known to be right, so one retry
        // usually gets a proper PIN-checked session.
        const { data: retry, error: retryError } = await supabase.rpc('staff_sign_in', { p_member_id: memberId, p_pin: pin })
        if (!retryError && retry?.valid && retry.session) {
          setStaffSession({ id: retry.session.id, token: retry.session.token, staffId: memberId, trust: 'pin' })
          return data
        }
        // The database really cannot check this PIN (unreadable hash): tell
        // it who verify-pin says signed in. It records the session as
        // "claimed", and refuses outright if it could have checked itself.
        const { data: claim, error } = await supabase.rpc('staff_session_claim', { p_member_id: memberId })
        if (!error && claim?.session) {
          setStaffSession({ id: claim.session.id, token: claim.session.token, staffId: memberId, trust: 'claimed' })
        }
      } catch { /* old database: no sessions yet */ }
    }
    return data
  }
}

/**
 * Re-check a PIN before a sensitive action (the PinGate). `purpose` says
 * what it is for ('z_report', 'price_change', 'fix_payment' ...) and is
 * recorded with the check. Does not change who is signed in.
 */
export async function verifyStaffPin(memberId, pin, purpose) {
  try {
    const { data, error } = await supabase.rpc('staff_verify_pin', {
      p_member_id: memberId,
      p_pin: pin,
      p_purpose: purpose ?? null,
    })
    if (error || !data) throw error ?? new Error('no response')
    return data
  } catch {
    return legacyVerify(memberId, pin)
  }
}

/**
 * End the current staff session on the server (best effort) and forget its
 * token. Never throws: signing out must always work, even offline.
 * @param {'sign_out'|'switch_user'|'idle_lock'|'close_day'|string} reason
 */
export async function signOutStaff(reason = 'sign_out') {
  const had = getStaffSession()
  try {
    if (had) await supabase.rpc('staff_sign_out', { p_reason: reason })
  } catch { /* offline or old database */ }
  // Only forget the session we ended: a new sign-in may have replaced it
  // while the request was in flight.
  if (getStaffSession()?.id === had?.id) clearStaffSession()
}

/**
 * Set or change a staff PIN. `currentPin` is required when one exists.
 * Resolves with { success: true } or { error, reason?, retryAfterSeconds? }.
 */
export async function setStaffPin(memberId, newPin, currentPin) {
  try {
    const { data, error } = await supabase.rpc('staff_set_pin', {
      p_member_id: memberId,
      p_new_pin: newPin,
      p_current_pin: currentPin ?? null,
    })
    if (error || !data) throw error ?? new Error('no response')
    return data
  } catch {
    const { data, error } = await supabase.functions.invoke('verify-pin', {
      body: { member_id: memberId, pin: newPin, mode: 'set', ...(currentPin ? { current_pin: currentPin } : {}) },
    })
    if (error || !data) {
      // verify-pin answers a refused change with a 403 whose JSON body
      // carries the reason; surface that rather than a bare failure.
      let body = null
      try { body = await error?.context?.json?.() } catch { /* not JSON */ }
      return body ?? { error: error?.message ?? 'Could not set PIN' }
    }
    return data
  }
}
