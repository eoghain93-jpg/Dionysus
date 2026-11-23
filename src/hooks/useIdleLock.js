// Auto-lock: after N minutes with no pointer, touch or key activity the till
// locks (see StaffGate / LockScreen). The open order is kept, and the lock
// screen still shows whose till it is.
//
// A lock is a real sign-out as far as the server is concerned: lockTill ends
// the person's server session and forgets its token, so nothing that happens
// at (or behind) a locked till can be recorded as them. Unlocking with their
// PIN is a fresh sign-in.
//
// N is localStorage 'idle_lock_minutes' (set in Settings): missing or not a
// number -> 5, 0 -> never lock.
//
// Built to cost nothing while the till is in use:
//   - activity is one timestamp written by passive listeners — no state, so
//     a touch never re-renders anything, and no timer is reset per touch;
//   - ONE timer, which wakes at most every 30 s (and exactly when the limit
//     is due), re-reads the setting and compares the clock. Re-reading on
//     every wake is what makes a change in Settings apply without a reload
//     (the browser's 'storage' event only fires in OTHER tabs).
//
// Never slows a working till down: a PIN cannot be checked without the
// server, so an idle lock that falls due while the till is offline
// (navigator.onLine) OR has learned the server is not answering
// (lib/audit/reachability.js — the broadband is down but the Wi-Fi is up) is
// skipped, and noted in the log once per spell. It locks once the server
// answers again if the till is still idle.

import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { logEvent } from '../lib/audit/log'
import { getStaffSession, clearStaffSession } from '../lib/audit/staffSession'
import { serverUnreachable, answersSeen } from '../lib/audit/reachability'

export const IDLE_LOCK_KEY = 'idle_lock_minutes'
export const DEFAULT_IDLE_LOCK_MINUTES = 5

const RECHECK_MS = 30_000
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel']
const LISTENER_OPTIONS = { capture: true, passive: true }

/** The configured idle time in minutes. 0 means never lock. */
export function idleLockMinutes() {
  try {
    const raw = globalThis.localStorage?.getItem(IDLE_LOCK_KEY)
    if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_IDLE_LOCK_MINUTES
    const minutes = Number(raw)
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_IDLE_LOCK_MINUTES
  } catch {
    return DEFAULT_IDLE_LOCK_MINUTES
  }
}

// A lock the server has not heard about. If it was not answering when the
// till locked, it still counts that session as open, and would go on
// matching the person's later work to it ("matched a sign-in") even after
// someone carried on without their PIN. So the ended session's token is kept
// — in memory only, attached to no request — and the server is told as soon
// as it answers again (the idle timer looks every 30 seconds).
let owedSignOut = null // { token, reason }

/** Test seam. */
export function __forgetOwedSignOut() {
  owedSignOut = null
}

function settleOwedSignOut() {
  const owed = owedSignOut
  if (!owed) return
  owedSignOut = null
  // Someone has signed in on this till since: that sign-in already ended
  // every earlier session here, on the server.
  if (getStaffSession()) return
  const before = answersSeen()
  import('../lib/supabase')
    .then(({ supabase }) => supabase.rpc('staff_sign_out', { p_reason: owed.reason, p_token: owed.token }))
    .catch(() => {})
    .then(() => {
      // Still no answer: keep it for the next look.
      if (answersSeen() === before) owedSignOut ??= owed
    })
}

// End the signed-in person's server session because the till has locked.
// Fire and forget: nothing here can delay or undo the lock.
function endStaffSession(reason) {
  const had = getStaffSession()
  if (!had) return // nothing was open (old database, or an unchecked carry-on)
  const forget = () => {
    // Only the session that was locked: never one opened since.
    if (getStaffSession()?.id === had.id) clearStaffSession()
  }
  // Loaded on demand (as NavBar's sign-out does) so that this hook never
  // drags the Supabase client into a module, or a test, that has no need of it.
  import('../lib/audit/staff')
    .then(({ signOutStaff }) => {
      const before = answersSeen()
      // Tells the server (best effort, never rejects). It has the token in
      // hand before it returns, so the till can forget it NOW rather than
      // when — or if — the server answers.
      const told = signOutStaff(reason)
      forget()
      return Promise.resolve(told).then(() => {
        if (answersSeen() === before) owedSignOut = { token: had.token, reason } // not heard
      })
    })
    .catch(forget)
}

/**
 * Lock the till now and record why. The one place 'till.locked' is logged.
 * Also ends the person's server session (see the top of this file); who is
 * shown as signed in, and the open order, are left alone.
 * @param {'idle'|'manual'} reason
 * @returns {boolean} whether the till was locked by this call
 */
export function lockTill(reason) {
  const { activeStaff, locked, lock } = useSessionStore.getState()
  if (!activeStaff || locked) return false
  logEvent('till.locked', { reason, minutes: idleLockMinutes() }, { severity: 0 })
  lock()
  endStaffSession(reason === 'idle' ? 'idle_lock' : 'manual_lock')
  return true
}

/**
 * Run the idle timer while `enabled` (someone is signed in and the till is
 * not already locked). Each time it is enabled the idle clock starts afresh.
 */
export function useIdleLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined

    let lastActivity = Date.now()
    let limitMs = 0
    let timer = null
    let skipLogged = false // one 'lock skipped' note per spell without the server

    const overdue = () => limitMs > 0 && Date.now() - lastActivity >= limitMs

    // Why a PIN could not be checked right now, or null if it could.
    function noServer() {
      if (globalThis.navigator?.onLine === false) return 'offline'
      if (serverUnreachable()) return 'unreachable'
      return null
    }

    // The limit has passed: lock — unless a PIN could not be checked, where
    // locking would only put a wait in front of every sale. Returns whether
    // it locked. (The note doubles as the probe: it stays queued until the
    // server takes it, and that answer is what clears "unreachable".)
    function lockOrSkip() {
      const reason = noServer()
      if (reason) {
        if (!skipLogged) {
          skipLogged = true
          logEvent('till.lock_skipped_offline', { reason }, { severity: 1 })
        }
        return false
      }
      return lockTill('idle')
    }

    function arm() {
      clearTimeout(timer)
      const remaining = lastActivity + limitMs - Date.now()
      // Not due yet: sleep until it is, but never longer than RECHECK_MS so
      // a changed setting is noticed. Disabled (0), or due but skipped
      // for want of the server: just look again later.
      const wait = limitMs > 0 && remaining > 0 ? Math.min(remaining, RECHECK_MS) : RECHECK_MS
      timer = setTimeout(check, wait)
    }

    function check() {
      limitMs = idleLockMinutes() * 60_000
      if (!noServer()) {
        skipLogged = false
        settleOwedSignOut()
      }
      if (overdue() && lockOrSkip()) return // locked: the effect cleans up
      arm()
    }

    function onActivity() {
      // If the limit passed while the timer could not run (tablet asleep,
      // tab in the background), the touch that wakes the till must lock it
      // rather than count as activity.
      if (overdue() && lockOrSkip()) return
      lastActivity = Date.now()
    }

    function onStorage(e) {
      if (!e.key || e.key === IDLE_LOCK_KEY) check()
    }

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, LISTENER_OPTIONS)
    window.addEventListener('storage', onStorage)
    check()

    return () => {
      clearTimeout(timer)
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, LISTENER_OPTIONS)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled])
}
