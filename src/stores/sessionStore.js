import { create } from 'zustand'
// staffSession is a plain module with no imports. Do NOT import
// ../lib/audit/log or ../lib/audit/staff here: log.js imports this store.
import { clearStaffSession } from '../lib/audit/staffSession'

export const useSessionStore = create((set) => ({
  activeStaff: null,

  // The till is locked (idle timeout or the Lock button): StaffGate shows
  // only the lock screen. activeStaff is kept so the lock screen can say
  // whose till it is, and the open order is kept — but the person is NOT
  // signed in as far as the server is concerned: locking through
  // useIdleLock.lockTill (the only way the app locks) ends their server
  // session and forgets its token, and unlocking with a PIN opens a new one.
  locked: false,

  // Only store the minimum fields — never persist pin_hash or other sensitive data.
  // A fresh sign-in always opens the till: a PIN has just been checked.
  setActiveStaff: (member) => {
    if (!member?.id || !member?.name) return
    set({ activeStaff: { id: member.id, name: member.name }, locked: false })
  },

  // Nothing to lock when nobody is signed in — the PIN login already shows.
  // These two only flip the flag. Use lockTill() to lock; the lock screen
  // decides what unlocking means for the server session (a fresh one after
  // a PIN, none at all after "carry on without checking").
  lock: () => set(state => (state.activeStaff ? { locked: true } : {})),
  unlock: () => set({ locked: false }),

  // Sign out on this till. Also forgets the server session token, so no
  // later request can go out under the name of the person who just left.
  // (Ending the session ON the server is signOutStaff's job; call that
  // first, while the token is still attached.)
  clearSession: () => {
    clearStaffSession()
    set({ activeStaff: null, locked: false })
  },
}))
