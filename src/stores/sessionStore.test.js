import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from './sessionStore'
import { setStaffSession, getStaffSession, getStaffToken } from '../lib/audit/staffSession'

// Reset store state before each test
beforeEach(() => {
  useSessionStore.setState({ activeStaff: null, locked: false })
  setStaffSession(null)
})

describe('sessionStore', () => {
  it('initialises with no active staff', () => {
    const { activeStaff } = useSessionStore.getState()
    expect(activeStaff).toBeNull()
  })

  it('setActiveStaff sets the active staff member', () => {
    const staff = { id: 'staff-1', name: 'Alice' }
    useSessionStore.getState().setActiveStaff(staff)
    expect(useSessionStore.getState().activeStaff).toEqual(staff)
  })

  it('setActiveStaff only stores id and name', () => {
    // Extra fields (e.g. pin_hash) must not leak into the store
    const staff = { id: 'staff-2', name: 'Bob', pin_hash: 'secret', membership_tier: 'staff' }
    useSessionStore.getState().setActiveStaff(staff)
    const stored = useSessionStore.getState().activeStaff
    expect(stored).toEqual({ id: 'staff-2', name: 'Bob' })
    expect(stored.pin_hash).toBeUndefined()
    expect(stored.membership_tier).toBeUndefined()
  })

  it('clearSession resets activeStaff to null', () => {
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' } })
    useSessionStore.getState().clearSession()
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  it('setActiveStaff with null input does not corrupt state', () => {
    useSessionStore.getState().setActiveStaff(null)
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  it('overwriting active staff replaces the previous session', () => {
    useSessionStore.getState().setActiveStaff({ id: 'staff-1', name: 'Alice' })
    useSessionStore.getState().setActiveStaff({ id: 'staff-2', name: 'Bob' })
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-2', name: 'Bob' })
  })

  // ── Server session token ───────────────────────────────────────────────────
  it('clearSession forgets the server session token', () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'staff-1', trust: 'pin' })
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' } })

    useSessionStore.getState().clearSession()

    expect(getStaffSession()).toBeNull()
    expect(getStaffToken()).toBeNull()
  })

  it('setActiveStaff leaves the server session token alone', () => {
    // signInStaff stores the token BEFORE the screen calls setActiveStaff
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'staff-1', trust: 'pin' })
    useSessionStore.getState().setActiveStaff({ id: 'staff-1', name: 'Alice' })
    expect(getStaffToken()).toBe('tok-1')
  })

  // ── Lock ───────────────────────────────────────────────────────────────────
  it('starts unlocked', () => {
    expect(useSessionStore.getState().locked).toBe(false)
  })

  it('lock keeps the signed-in person and unlock carries on', () => {
    useSessionStore.getState().setActiveStaff({ id: 'staff-1', name: 'Alice' })

    useSessionStore.getState().lock()
    expect(useSessionStore.getState().locked).toBe(true)
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-1', name: 'Alice' })

    useSessionStore.getState().unlock()
    expect(useSessionStore.getState().locked).toBe(false)
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-1', name: 'Alice' })
  })

  // The store's lock() only flips the flag. Ending the server session is
  // lockTill's job (hooks/useIdleLock.js), which is how the app locks.
  it('lock() itself leaves the server session token to lockTill', () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'staff-1', trust: 'pin' })
    useSessionStore.getState().setActiveStaff({ id: 'staff-1', name: 'Alice' })
    useSessionStore.getState().lock()
    expect(getStaffToken()).toBe('tok-1')
  })

  it('lock does nothing when nobody is signed in', () => {
    useSessionStore.getState().lock()
    expect(useSessionStore.getState().locked).toBe(false)
  })

  it('a new sign-in unlocks the till', () => {
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' }, locked: true })
    useSessionStore.getState().setActiveStaff({ id: 'staff-2', name: 'Bob' })
    expect(useSessionStore.getState().locked).toBe(false)
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-2', name: 'Bob' })
  })

  it('an invalid sign-in does not unlock the till', () => {
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' }, locked: true })
    useSessionStore.getState().setActiveStaff({ name: 'No id' })
    expect(useSessionStore.getState().locked).toBe(true)
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-1', name: 'Alice' })
  })

  it('clearSession also clears the lock', () => {
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' }, locked: true })
    useSessionStore.getState().clearSession()
    expect(useSessionStore.getState()).toMatchObject({ activeStaff: null, locked: false })
  })
})
