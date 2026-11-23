// Auto-lock: after N minutes with no pointer, touch or key activity the till
// locks (see StaffGate / LockScreen). The signed-in person and the open order
// are kept; a PIN carries on.
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
// Never strands a working till: a PIN cannot be checked offline, so an idle
// lock that falls due while navigator.onLine is false is skipped (and noted
// in the log once per offline spell). It locks once the connection is back
// if the till is still idle.

import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { logEvent } from '../lib/audit/log'

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

/**
 * Lock the till now and record why. The one place 'till.locked' is logged.
 * @param {'idle'|'manual'} reason
 * @returns {boolean} whether the till was locked by this call
 */
export function lockTill(reason) {
  const { activeStaff, locked, lock } = useSessionStore.getState()
  if (!activeStaff || locked) return false
  logEvent('till.locked', { reason, minutes: idleLockMinutes() }, { severity: 0 })
  lock()
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
    let skipLogged = false // one 'lock skipped' note per offline spell

    const overdue = () => limitMs > 0 && Date.now() - lastActivity >= limitMs

    // The limit has passed: lock — unless offline, where a PIN could not be
    // checked and the till would be stuck. Returns whether it locked.
    function lockOrSkip() {
      if (globalThis.navigator?.onLine === false) {
        if (!skipLogged) {
          skipLogged = true
          logEvent('till.lock_skipped_offline', {}, { severity: 1 })
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
      // offline: just look again later.
      const wait = limitMs > 0 && remaining > 0 ? Math.min(remaining, RECHECK_MS) : RECHECK_MS
      timer = setTimeout(check, wait)
    }

    function check() {
      limitMs = idleLockMinutes() * 60_000
      if (globalThis.navigator?.onLine !== false) skipLogged = false
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
