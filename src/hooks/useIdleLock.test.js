import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, fireEvent } from '@testing-library/react'

const { mockSignOut, mockRpc } = vi.hoisted(() => ({ mockSignOut: vi.fn(), mockRpc: vi.fn() }))

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/audit/staff', () => ({ signOutStaff: mockSignOut }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mockRpc } }))

import { useIdleLock, lockTill, idleLockMinutes, IDLE_LOCK_KEY, __forgetOwedSignOut } from './useIdleLock'
import { useSessionStore } from '../stores/sessionStore'
import { logEvent } from '../lib/audit/log'
import { setStaffSession, getStaffSession, getStaffToken } from '../lib/audit/staffSession'
import { markReached, markUnreachable } from '../lib/audit/reachability'

const MIN = 60_000
const ALICE = { id: 'staff-1', name: 'Alice' }

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const isLocked = () => useSessionStore.getState().locked
const eventsOfType = type => logEvent.mock.calls.filter(c => c[0] === type)
const signIn = (id = 'sess-1') => setStaffSession({ id, token: `tok-${id}`, staffId: 'staff-1', trust: 'pin' })

// In the app the fetch wrapper notes every answer the server gives to a
// database write (lib/audit/reachability.js). Here the server is the mocks,
// so they do the noting.
const answers = async () => { markReached() }
const noAnswer = async () => {}
const lateSignOuts = () => mockRpc.mock.calls.filter(c => c[0] === 'staff_sign_out')

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockSignOut.mockReset().mockImplementation(answers)
  mockRpc.mockReset().mockImplementation(answers)
  __forgetOwedSignOut()
  localStorage.clear()
  setNavigatorOnline(true)
  markReached()
  setStaffSession(null)
  useSessionStore.setState({ activeStaff: ALICE, locked: false })
})

afterEach(() => {
  vi.useRealTimers()
  setNavigatorOnline(true)
  markReached()
  setStaffSession(null)
  useSessionStore.setState({ activeStaff: null, locked: false })
})

describe('idleLockMinutes', () => {
  it('defaults to 5 when the setting is missing', () => {
    expect(idleLockMinutes()).toBe(5)
  })

  it('reads a number from localStorage', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '12')
    expect(idleLockMinutes()).toBe(12)
  })

  it('reads 0 as 0 (never lock), not as "missing"', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '0')
    expect(idleLockMinutes()).toBe(0)
  })

  it.each(['', '  ', 'abc', 'NaN', '-3', 'Infinity', '{"a":1}'])('falls back to 5 for the invalid value %j', (raw) => {
    localStorage.setItem(IDLE_LOCK_KEY, raw)
    expect(idleLockMinutes()).toBe(5)
  })
})

describe('lockTill', () => {
  it('locks and logs till.locked with the reason and the configured minutes', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '10')
    expect(lockTill('manual')).toBe(true)
    expect(isLocked()).toBe(true)
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'manual', minutes: 10 }, { severity: 0 })
  })

  it('does nothing (and logs nothing) when already locked', () => {
    useSessionStore.setState({ locked: true })
    expect(lockTill('manual')).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('does nothing when nobody is signed in', () => {
    useSessionStore.setState({ activeStaff: null })
    expect(lockTill('idle')).toBe(false)
    expect(isLocked()).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()
  })

  // ── A lock ends the server session ─────────────────────────────────────────
  it.each([
    ['idle', 'idle_lock'],
    ['manual', 'manual_lock'],
  ])('a lock (%s) ends the server session, told as "%s", and forgets its token', async (reason, told) => {
    signIn()
    let tokenWhenServerWasTold
    mockSignOut.mockImplementation(async () => { tokenWhenServerWasTold = getStaffToken(); markReached() })

    expect(lockTill(reason)).toBe(true)
    expect(isLocked()).toBe(true) // at once: nothing below can hold the lock up

    await vi.waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
    expect(mockSignOut).toHaveBeenCalledWith(told)
    expect(tokenWhenServerWasTold).toBe('tok-sess-1') // still in hand for the server call
    expect(getStaffSession()).toBeNull()
    expect(getStaffToken()).toBeNull()
    // whose till it is stays on show
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
  })

  it('forgets the token without waiting for the server to answer', async () => {
    signIn()
    mockSignOut.mockReturnValue(new Promise(() => {})) // the server never answers
    lockTill('idle')
    await vi.waitFor(() => expect(getStaffToken()).toBeNull())
  })

  it('forgets the token even if telling the server blows up', async () => {
    signIn()
    mockSignOut.mockImplementation(() => { throw new Error('boom') })
    expect(lockTill('manual')).toBe(true)
    await vi.waitFor(() => expect(getStaffToken()).toBeNull())
    expect(isLocked()).toBe(true)
  })

  it('never forgets a session opened since the lock', async () => {
    signIn('sess-1')
    mockSignOut.mockImplementation(async () => { signIn('sess-2') }) // someone signed in meanwhile
    lockTill('idle')
    await vi.waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    expect(getStaffSession()?.id).toBe('sess-2')
  })

  it('has nothing to tell the server when no session was open', async () => {
    expect(lockTill('idle')).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('does not end the session when it did not lock', async () => {
    signIn()
    useSessionStore.setState({ locked: true })
    expect(lockTill('manual')).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(getStaffToken()).toBe('tok-sess-1')
  })
})

// The server still counts a session as open until it is told otherwise, and
// would go on matching that person's work to it after an unchecked carry-on.
describe('a lock the server did not hear about', () => {
  // The till locks with the server not answering, and someone carries on
  // without the PIN: unlocked again, no session, "unreachable" remembered.
  async function lockUnheardThenCarryOn() {
    signIn()
    mockSignOut.mockImplementation(noAnswer)
    renderHook(() => useIdleLock(true))
    lockTill('idle')
    await vi.waitFor(() => expect(getStaffToken()).toBeNull())
    markUnreachable() // the lock screen's PIN check got no answer either
    useSessionStore.getState().unlock()
  }

  it('is told to the server as soon as it answers again, with the ended session\'s own token', async () => {
    await lockUnheardThenCarryOn()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(lateSignOuts()).toHaveLength(0) // not while the server is known to be away

    markReached() // any database write got an answer
    await vi.advanceTimersByTimeAsync(30_000) // the next look
    await vi.waitFor(() => expect(lateSignOuts()).toHaveLength(1))
    expect(mockRpc).toHaveBeenCalledWith('staff_sign_out', { p_reason: 'idle_lock', p_token: 'tok-sess-1' })
    expect(getStaffToken()).toBeNull() // told in the request body only: nothing is signed back in

    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(lateSignOuts()).toHaveLength(1) // once heard, never again
  })

  it('keeps trying while there is still no answer', async () => {
    await lockUnheardThenCarryOn()
    mockRpc.mockImplementation(noAnswer)
    markReached()
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(lateSignOuts()).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(lateSignOuts()).toHaveLength(2))
  })

  it('is dropped once someone has signed in on the till (that sign-in ended it on the server)', async () => {
    await lockUnheardThenCarryOn()
    signIn('sess-2')
    markReached()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(lateSignOuts()).toHaveLength(0)
    expect(getStaffSession()?.id).toBe('sess-2')
  })

  it('is not owed when the server answered the lock', async () => {
    signIn()
    renderHook(() => useIdleLock(true))
    lockTill('manual')
    await vi.waitFor(() => expect(mockSignOut).toHaveBeenCalledWith('manual_lock'))
    useSessionStore.getState().unlock()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(lateSignOuts()).toHaveLength(0)
  })
})

describe('useIdleLock', () => {
  it('locks after the default 5 minutes without activity — not before', () => {
    renderHook(() => useIdleLock(true))

    vi.advanceTimersByTime(5 * MIN - 1)
    expect(isLocked()).toBe(false)

    vi.advanceTimersByTime(1)
    expect(isLocked()).toBe(true)
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE) // still signed in
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'idle', minutes: 5 }, { severity: 0 })
  })

  it('locks after the configured time', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '2')
    renderHook(() => useIdleLock(true))

    vi.advanceTimersByTime(2 * MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isLocked()).toBe(true)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'idle', minutes: 2 }, { severity: 0 })
  })

  it('uses 5 minutes when the setting is not a number', () => {
    localStorage.setItem(IDLE_LOCK_KEY, 'soon')
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(5 * MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isLocked()).toBe(true)
  })

  it('0 disables the lock entirely', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '0')
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(12 * 60 * MIN)
    expect(isLocked()).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['a pointer press', () => fireEvent.pointerDown(document.body)],
    ['a pointer move', () => fireEvent.pointerMove(document.body)],
    ['a touch', () => fireEvent.touchStart(document.body)],
    ['a key press', () => fireEvent.keyDown(document.body, { key: 'a' })],
    ['a scroll wheel', () => fireEvent.wheel(document.body)],
  ])('%s resets the idle clock', (_name, act) => {
    renderHook(() => useIdleLock(true))

    vi.advanceTimersByTime(4 * MIN)
    act()
    vi.advanceTimersByTime(4 * MIN) // 8 minutes in, 4 since the activity
    expect(isLocked()).toBe(false)

    vi.advanceTimersByTime(MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(1) // exactly 5 minutes after the activity
    expect(isLocked()).toBe(true)
  })

  it('activity inside something that stops propagation still counts', () => {
    const button = document.createElement('button')
    button.addEventListener('pointerdown', e => e.stopPropagation())
    document.body.appendChild(button)
    renderHook(() => useIdleLock(true))

    vi.advanceTimersByTime(4 * MIN)
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(4 * MIN)
    expect(isLocked()).toBe(false)
    button.remove()
  })

  it('never re-renders its component on activity, and runs one timer', () => {
    let renders = 0
    renderHook(() => { renders += 1; useIdleLock(true) })
    const before = renders

    for (let i = 0; i < 200; i += 1) {
      fireEvent.pointerMove(document.body)
      fireEvent.pointerDown(document.body)
      fireEvent.keyDown(document.body, { key: 'x' })
    }

    expect(renders).toBe(before)
    expect(vi.getTimerCount()).toBe(1)
  })

  // ── Never strand a working till ────────────────────────────────────────────
  it('does not lock while offline, and says so once per offline spell', () => {
    renderHook(() => useIdleLock(true))
    setNavigatorOnline(false)

    vi.advanceTimersByTime(5 * MIN)
    expect(isLocked()).toBe(false)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.lock_skipped_offline', { reason: 'offline' }, { severity: 1 })

    // still offline and idle an hour later: no lock, no second note
    vi.advanceTimersByTime(60 * MIN)
    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)

    // used, then idle again in the same offline spell: still one note
    fireEvent.pointerDown(document.body)
    vi.advanceTimersByTime(20 * MIN)
    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)
    expect(eventsOfType('till.locked')).toHaveLength(0)
  })

  it('locks once the connection is back if the till is still idle', () => {
    renderHook(() => useIdleLock(true))
    setNavigatorOnline(false)
    vi.advanceTimersByTime(10 * MIN)
    expect(isLocked()).toBe(false)

    setNavigatorOnline(true)
    vi.advanceTimersByTime(30_000) // the next look at the clock
    expect(isLocked()).toBe(true)
    expect(logEvent).toHaveBeenLastCalledWith('till.locked', { reason: 'idle', minutes: 5 }, { severity: 0 })
  })

  it('does not lock on reconnect if the till was in use while offline', () => {
    renderHook(() => useIdleLock(true))
    setNavigatorOnline(false)
    vi.advanceTimersByTime(10 * MIN)
    fireEvent.pointerDown(document.body) // someone serving, offline

    setNavigatorOnline(true)
    vi.advanceTimersByTime(4 * MIN)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(MIN)
    expect(isLocked()).toBe(true)
  })

  it('notes a skipped lock again in a NEW offline spell', () => {
    renderHook(() => useIdleLock(true))
    setNavigatorOnline(false)
    vi.advanceTimersByTime(6 * MIN)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)

    // someone carries on serving, then the connection returns for a while
    fireEvent.pointerDown(document.body)
    setNavigatorOnline(true)
    vi.advanceTimersByTime(MIN)
    fireEvent.pointerDown(document.body)

    // offline again, idle past the limit
    setNavigatorOnline(false)
    vi.advanceTimersByTime(6 * MIN)
    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(2)
  })

  it('a touch after the connection returns locks a till that sat idle past its time offline', () => {
    renderHook(() => useIdleLock(true))
    setNavigatorOnline(false)
    vi.advanceTimersByTime(6 * MIN)

    setNavigatorOnline(true)
    fireEvent.pointerDown(document.body) // before the timer has looked again

    expect(isLocked()).toBe(true)
  })

  // ── Broadband down, Wi-Fi up: the browser says online, the server is not there ──
  it('does not lock while the server is known to be unreachable, and says so once', () => {
    signIn()
    renderHook(() => useIdleLock(true))
    markUnreachable() // a PIN check or sign-out got no answer

    vi.advanceTimersByTime(5 * MIN)
    expect(isLocked()).toBe(false)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.lock_skipped_offline', { reason: 'unreachable' }, { severity: 1 })

    vi.advanceTimersByTime(60 * MIN)
    fireEvent.pointerDown(document.body)
    vi.advanceTimersByTime(20 * MIN)
    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)
    expect(eventsOfType('till.locked')).toHaveLength(0)
    // not locked, so the person's session carries on
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(getStaffToken()).toBe('tok-sess-1')
  })

  it('locks by itself once the server answers again, if the till is still idle', () => {
    renderHook(() => useIdleLock(true))
    markUnreachable()
    vi.advanceTimersByTime(10 * MIN)
    expect(isLocked()).toBe(false)

    markReached() // any database write got an answer
    vi.advanceTimersByTime(30_000) // the next look at the clock
    expect(isLocked()).toBe(true)
    expect(logEvent).toHaveBeenLastCalledWith('till.locked', { reason: 'idle', minutes: 5 }, { severity: 0 })
  })

  it('does not lock when the server comes back if the till was in use meanwhile', () => {
    renderHook(() => useIdleLock(true))
    markUnreachable()
    vi.advanceTimersByTime(10 * MIN)
    fireEvent.pointerDown(document.body) // serving through the outage

    markReached()
    vi.advanceTimersByTime(4 * MIN)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(MIN)
    expect(isLocked()).toBe(true)
  })

  it('notes a skipped lock again in a NEW spell without the server, with the reason for each', () => {
    renderHook(() => useIdleLock(true))
    markUnreachable()
    vi.advanceTimersByTime(6 * MIN)

    fireEvent.pointerDown(document.body)
    markReached()
    vi.advanceTimersByTime(MIN)
    fireEvent.pointerDown(document.body)

    setNavigatorOnline(false)
    vi.advanceTimersByTime(6 * MIN)
    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline').map(c => c[1])).toEqual([
      { reason: 'unreachable' },
      { reason: 'offline' },
    ])
  })

  it('the touch that wakes a till while the server is unreachable counts as activity, not a lock', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(MIN)
    markUnreachable()
    vi.setSystemTime(Date.now() + 20 * MIN)

    fireEvent.pointerDown(document.body)

    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)
  })

  // ── The setting can change without a reload ────────────────────────────────
  it('picks up a shorter time set in this tab (no storage event) within 30 seconds', () => {
    renderHook(() => useIdleLock(true)) // 5 minutes
    vi.advanceTimersByTime(MIN)
    localStorage.setItem(IDLE_LOCK_KEY, '2')

    vi.advanceTimersByTime(MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(1) // 2 minutes idle
    expect(isLocked()).toBe(true)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'idle', minutes: 2 }, { severity: 0 })
  })

  it('picks up a longer time set in this tab', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '1')
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(40_000)
    localStorage.setItem(IDLE_LOCK_KEY, '3')

    vi.advanceTimersByTime(2 * MIN) // 2m40s idle: the old 1 minute has long passed
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(20_000)
    expect(isLocked()).toBe(true)
  })

  it('applies a change from another tab at once (storage event)', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(90_000)

    localStorage.setItem(IDLE_LOCK_KEY, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: IDLE_LOCK_KEY, newValue: '1' }))

    expect(isLocked()).toBe(true) // already 90 s idle
  })

  it('ignores storage events for other keys', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(90_000)
    localStorage.setItem(IDLE_LOCK_KEY, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'printer_ip', newValue: '1.2.3.4' }))
    expect(isLocked()).toBe(false)
  })

  it('starts locking when the setting goes from 0 (never) to a time', () => {
    localStorage.setItem(IDLE_LOCK_KEY, '0')
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(30 * MIN)
    expect(isLocked()).toBe(false)

    fireEvent.pointerDown(document.body)
    localStorage.setItem(IDLE_LOCK_KEY, '1')
    vi.advanceTimersByTime(MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(30_000)
    expect(isLocked()).toBe(true)
  })

  it('stops locking when the setting goes to 0', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(MIN)
    localStorage.setItem(IDLE_LOCK_KEY, '0')
    vi.advanceTimersByTime(60 * MIN)
    expect(isLocked()).toBe(false)
  })

  // ── Tablet asleep / timers frozen ──────────────────────────────────────────
  it('the touch that wakes a till whose time ran out while asleep locks it instead of counting as activity', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(MIN)

    // the clock moves on 20 minutes but no timer has fired (device asleep)
    vi.setSystemTime(Date.now() + 20 * MIN)
    fireEvent.pointerDown(document.body)

    expect(isLocked()).toBe(true)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'idle', minutes: 5 }, { severity: 0 })
  })

  it('waking offline does not lock; the touch counts and the skip is noted', () => {
    renderHook(() => useIdleLock(true))
    vi.advanceTimersByTime(MIN)
    setNavigatorOnline(false)
    vi.setSystemTime(Date.now() + 20 * MIN)

    fireEvent.pointerDown(document.body)

    expect(isLocked()).toBe(false)
    expect(eventsOfType('till.lock_skipped_offline')).toHaveLength(1)
    // that touch restarted the clock
    setNavigatorOnline(true)
    vi.advanceTimersByTime(4 * MIN)
    expect(isLocked()).toBe(false)
  })

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  it('does nothing while disabled', () => {
    renderHook(() => useIdleLock(false))
    vi.advanceTimersByTime(60 * MIN)
    expect(isLocked()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts the idle clock afresh each time it is enabled', () => {
    const { rerender } = renderHook(({ on }) => useIdleLock(on), { initialProps: { on: true } })
    vi.advanceTimersByTime(4 * MIN)
    rerender({ on: false })
    vi.advanceTimersByTime(10 * MIN)
    expect(isLocked()).toBe(false)

    rerender({ on: true })
    vi.advanceTimersByTime(5 * MIN - 1)
    expect(isLocked()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isLocked()).toBe(true)
  })

  it('removes its timer and listeners on unmount', () => {
    const { unmount } = renderHook(() => useIdleLock(true))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(Date.now() + 20 * MIN)
    fireEvent.pointerDown(document.body)
    vi.advanceTimersByTime(20 * MIN)
    expect(isLocked()).toBe(false)
  })
})
