import { create } from 'zustand'
// staffSession is a plain module with no imports. Do NOT import
// ../lib/audit/log or ../lib/audit/staff here: log.js imports this store.
import { clearStaffSession } from '../lib/audit/staffSession'

export const useSessionStore = create((set) => ({
  activeStaff: null,

  // The till is locked (idle timeout or the Lock button): the person stays
  // signed in and the open order is kept, but StaffGate shows only the lock
  // screen until a PIN is entered.
  locked: false,

  // Only store the minimum fields — never persist pin_hash or other sensitive data.
  // A fresh sign-in always opens the till: a PIN has just been checked.
  setActiveStaff: (member) => {
    if (!member?.id || !member?.name) return
    set({ activeStaff: { id: member.id, name: member.name }, locked: false })
  },

  // Nothing to lock when nobody is signed in — the PIN login already shows.
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
