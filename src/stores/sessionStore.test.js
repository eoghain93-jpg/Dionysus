import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from './sessionStore'

// Reset store state before each test
beforeEach(() => {
  useSessionStore.setState({ activeStaff: null })
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
})
