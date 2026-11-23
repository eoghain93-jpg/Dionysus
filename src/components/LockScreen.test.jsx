import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

const { mockVerify, mockSignIn, mockSignOut, mockSetPin, mockFrom } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockSignIn: vi.fn(),
  mockSignOut: vi.fn(),
  mockSetPin: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: vi.fn() } },
}))
vi.mock('../lib/audit/staff', () => ({
  verifyStaffPin: mockVerify,
  signInStaff: mockSignIn,
  signOutStaff: mockSignOut,
  setStaffPin: mockSetPin,
}))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

import LockScreen from './LockScreen'
import { useSessionStore } from '../stores/sessionStore'
import { logEvent } from '../lib/audit/log'
import { setStaffSession, getStaffSession, getStaffToken } from '../lib/audit/staffSession'
import { markReached, markUnreachable, serverUnreachable } from '../lib/audit/reachability'

const ALICE = { id: 'staff-1', name: 'Alice' }
const BOB = { id: 'staff-2', name: 'Bob' }
const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

function enterPin(pin = '1234') {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
}

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

// What the real signInStaff does when the database accepts a PIN: it opens a
// server session and keeps its token.
function acceptPin(sessionId = 'sess-new') {
  return async (memberId) => {
    setStaffSession({ id: sessionId, token: `tok-${sessionId}`, staffId: memberId, trust: 'pin' })
    return { valid: true, member: STAFF.find(m => m.id === memberId) }
  }
}

const session = () => useSessionStore.getState()
const carryOnButton = () => screen.queryByRole('button', { name: /carry on without checking the pin/i })

beforeEach(() => {
  vi.clearAllMocks()
  mockSignIn.mockReset()
  mockSignOut.mockReset()
  setNavigatorOnline(true)
  markReached()
  setStaffSession(null) // a locked till holds no server session (lockTill ended it)
  useSessionStore.setState({ activeStaff: ALICE, locked: true })
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: STAFF, error: null }),
  })
})

afterEach(() => {
  cleanup() // unmount before the store is reset
  vi.useRealTimers()
  setNavigatorOnline(true)
  markReached()
  setStaffSession(null)
  useSessionStore.setState({ activeStaff: null, locked: false })
})

describe('LockScreen', () => {
  it('says the till is locked and whose PIN it wants', () => {
    render(<LockScreen />)
    expect(screen.getByRole('heading', { name: /till locked/i })).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /till locked/i })).toBeInTheDocument()
  })

  // ── The signed-in person carries on ────────────────────────────────────────
  it('unlocks with that person\'s PIN as a full sign-in, leaving a fresh server session', async () => {
    mockSignIn.mockImplementation(acceptPin('sess-fresh'))
    render(<LockScreen />)
    enterPin('4821')

    await waitFor(() => expect(session().locked).toBe(false))
    expect(mockSignIn).toHaveBeenCalledTimes(1)
    expect(mockSignIn).toHaveBeenCalledWith('staff-1', '4821')
    // not a bare re-check: that would leave the till with no session at all
    expect(mockVerify).not.toHaveBeenCalled()
    expect(getStaffSession()).toMatchObject({ id: 'sess-fresh', staffId: 'staff-1', trust: 'pin' })
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(session().activeStaff).toEqual(ALICE)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', {}, { severity: 0 })
  })

  it('stays locked on a wrong PIN and offers no way round it', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 3 })
    render(<LockScreen />)
    enterPin('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(session().locked).toBe(true)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
    expect(getStaffSession()).toBeNull()
    expect(screen.getByLabelText(/PIN display/i).querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('offers no way round after any number of plain wrong PINs', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 1 })
    render(<LockScreen />)
    for (const pin of ['0000', '1111', '2222', '3333']) {
      enterPin(pin)
      await waitFor(() => expect(mockSignIn).toHaveBeenLastCalledWith('staff-1', pin))
      await screen.findByText(/incorrect pin/i)
      expect(carryOnButton()).not.toBeInTheDocument()
    }
    expect(session().locked).toBe(true)
  })

  it('points to "Someone else" when the signed-in person has no PIN', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'no_pin' })
    render(<LockScreen />)
    enterPin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pin is set/i)
    expect(session().locked).toBe(true)
    expect(carryOnButton()).not.toBeInTheDocument()
  })

  // ── Never strand a working till: the PIN is locked out ─────────────────────
  it('when the PIN is locked out: shows the countdown, disables the numpad, and offers the recorded carry-on', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<LockScreen />)
    enterPin()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/locked after too many attempts/i)
    expect(status).toHaveTextContent(/15:00/)
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    // someone else can still get in
    expect(screen.getByRole('button', { name: /someone else/i })).toBeEnabled()
    // and a sole bartender is not stuck for 15 minutes — but is told plainly what it means
    expect(carryOnButton()).toBeInTheDocument()
    expect(status).toHaveTextContent(/carry on as Alice without the PIN/i)
    expect(status).toHaveTextContent(/recorded and shown to the owner/i)
    expect(session().locked).toBe(true) // offered, not done
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('carrying on past a locked-out PIN is recorded as serious and leaves NO server session', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<LockScreen />)
    enterPin()
    const button = await screen.findByRole('button', { name: /carry on without checking the pin/i })
    // even if a token were somehow still in memory, it must not carry on
    setStaffSession({ id: 'sess-old', token: 'tok-old', staffId: 'staff-1', trust: 'pin' })

    fireEvent.click(button)

    expect(session().locked).toBe(false)
    expect(session().activeStaff).toEqual(ALICE) // the SAME person
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked_unverified', { reason: 'pin_locked' }, { severity: 3 })
    expect(getStaffSession()).toBeNull()
    expect(getStaffToken()).toBeNull()
  })

  // ── Never strand a working till: the server cannot be reached ──────────────
  it('does not offer to carry on unchecked before a PIN check has failed to reach the server', () => {
    render(<LockScreen />)
    expect(carryOnButton()).not.toBeInTheDocument()
  })

  it('offers "Carry on without checking the PIN" after the check REJECTS, and records its use', async () => {
    mockSignIn.mockRejectedValue(new Error('Failed to fetch'))
    render(<LockScreen />)
    enterPin()

    const button = await screen.findByRole('button', { name: /carry on without checking the pin/i })
    expect(screen.getByRole('alert')).toHaveTextContent(/can.t reach the server/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/recorded and shown to the owner/i)
    expect(session().locked).toBe(true) // offered, not done
    expect(logEvent).not.toHaveBeenCalled()
    expect(serverUnreachable()).toBe(true) // remembered for the idle lock and the next lock screen
    setStaffSession({ id: 'sess-old', token: 'tok-old', staffId: 'staff-1', trust: 'pin' })

    fireEvent.click(button)

    expect(session().locked).toBe(false)
    expect(session().activeStaff).toEqual(ALICE) // the SAME person
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked_unverified', { reason: 'unreachable' }, { severity: 2 })
    // nobody's PIN was accepted: what follows is "said to be", not "PIN checked"
    expect(getStaffSession()).toBeNull()
    expect(getStaffToken()).toBeNull()
  })

  it('treats a PIN check that never answers as unreachable after 8 seconds (no endless "Verifying…")', async () => {
    vi.useFakeTimers()
    mockSignIn.mockReturnValue(new Promise(() => {}))
    render(<LockScreen />)
    enterPin()

    await act(async () => { await vi.advanceTimersByTimeAsync(7_999) })
    expect(screen.getByText(/verifying/i)).toBeInTheDocument()
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(serverUnreachable()).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument()
    expect(carryOnButton()).toBeInTheDocument()
    expect(serverUnreachable()).toBe(true)
    expect(session().locked).toBe(true)
    // the numpad works again for another try
    expect(screen.getByRole('button', { name: '5' })).toBeEnabled()
  })

  it('offers the carry-on at once when the till already knows the server is unreachable (no second wait)', () => {
    markUnreachable() // an earlier lock screen, or a sign-out, got no answer
    render(<LockScreen />)

    expect(carryOnButton()).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/can.t reach the server/i)
    expect(mockSignIn).not.toHaveBeenCalled()

    fireEvent.click(carryOnButton())
    expect(session().locked).toBe(false)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked_unverified', { reason: 'unreachable' }, { severity: 2 })
    expect(getStaffSession()).toBeNull()
  })

  it('offers the carry-on at once when the till is offline', () => {
    setNavigatorOnline(false)
    render(<LockScreen />)
    expect(carryOnButton()).toBeInTheDocument()
  })

  it('withdraws the offer as soon as the server answers again', async () => {
    mockSignIn
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ valid: false, attemptsRemaining: 4 })
    render(<LockScreen />)

    enterPin()
    await screen.findByRole('button', { name: /carry on without checking the pin/i })

    enterPin('9999')
    await screen.findByText(/incorrect pin/i)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(serverUnreachable()).toBe(false) // a PIN can be checked again
    expect(session().locked).toBe(true)
  })

  it('a correct PIN after a failed check unlocks normally (verified, not "unverified")', async () => {
    mockSignIn
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementationOnce(acceptPin())
    render(<LockScreen />)
    enterPin()
    await screen.findByRole('button', { name: /carry on without checking the pin/i })
    enterPin()

    await waitFor(() => expect(session().locked).toBe(false))
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', {}, { severity: 0 })
    expect(getStaffSession()?.id).toBe('sess-new')
  })

  it('a slow answer still counts: a correct PIN answered after the 8 seconds unlocks, verified', async () => {
    vi.useFakeTimers()
    let answer
    mockSignIn.mockReturnValue(new Promise(resolve => { answer = resolve }))
    render(<LockScreen />)
    enterPin()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(carryOnButton()).toBeInTheDocument()
    expect(session().locked).toBe(true)

    await act(async () => { answer(await acceptPin('sess-late')('staff-1')) })

    expect(session().locked).toBe(false)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', {}, { severity: 0 })
    expect(getStaffSession()?.id).toBe('sess-late')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(serverUnreachable()).toBe(false)
  })

  // ── A PIN answer that arrives too late to be used opens nothing ────────────
  it('a PIN check answered after the lock screen has gone does nothing, and the session it opened is ended', async () => {
    let answer
    mockSignIn
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    const { unmount } = render(<LockScreen />)
    enterPin()
    fireEvent.click(await screen.findByRole('button', { name: /carry on without checking the pin/i }))
    expect(session().locked).toBe(false)
    logEvent.mockClear()

    // a second check was started, the screen goes, the till is locked again
    act(() => session().lock())
    enterPin()
    unmount()
    await act(async () => { answer(await acceptPin('sess-stray')('staff-1')) })

    expect(session().locked).toBe(true)
    expect(logEvent).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith('unused_unlock')
  })

  it('a PIN answer that arrives after "carry on" does not turn the unchecked work into "PIN checked"', async () => {
    vi.useFakeTimers()
    let answer
    mockSignIn.mockReturnValue(new Promise(resolve => { answer = resolve }))
    render(<LockScreen />)
    enterPin()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    fireEvent.click(carryOnButton())
    expect(session().locked).toBe(false)
    expect(getStaffSession()).toBeNull()
    logEvent.mockClear()

    await act(async () => { answer(await acceptPin('sess-stray')('staff-1')) })

    expect(mockSignOut).toHaveBeenCalledWith('unused_unlock')
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('a PIN answer that arrives after someone else has signed in is not kept under their feet', async () => {
    vi.useFakeTimers()
    let answer
    mockSignIn.mockReturnValue(new Promise(resolve => { answer = resolve }))
    render(<LockScreen />)
    enterPin()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    // Bob signs in through "Someone else" (which unlocks the till) ...
    act(() => session().setActiveStaff(BOB))
    logEvent.mockClear()

    // ... and then the answer to Alice's PIN turns up, replacing the token in memory
    await act(async () => { answer(await acceptPin('sess-stray')('staff-1')) })

    expect(session()).toMatchObject({ activeStaff: BOB, locked: false })
    expect(mockSignOut).toHaveBeenCalledWith('unused_unlock')
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('a late WRONG-PIN answer withdraws the offer made while waiting', async () => {
    vi.useFakeTimers()
    let answer
    mockSignIn.mockReturnValue(new Promise(resolve => { answer = resolve }))
    render(<LockScreen />)
    enterPin()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(carryOnButton()).toBeInTheDocument()

    await act(async () => { answer({ valid: false, attemptsRemaining: 2 }) })

    expect(carryOnButton()).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(session().locked).toBe(true)
  })

  // ── Someone else ───────────────────────────────────────────────────────────
  it('"Someone else" shows the normal staff picker; signing in unlocks as that person', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-2', name: 'Bob' } })
    render(<LockScreen />)
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))

    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-2' } })
    enterPin('2468')

    await waitFor(() => expect(session().activeStaff).toEqual({ id: 'staff-2', name: 'Bob' }))
    expect(session().locked).toBe(false)
    expect(mockSignIn).toHaveBeenCalledTimes(1)
    expect(mockSignIn).toHaveBeenCalledWith('staff-2', '2468')
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', { via: 'sign_in' }, { severity: 0 })
  })

  it('a wrong PIN for someone else leaves the till locked under the original person', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 4 })
    render(<LockScreen />)
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-2' } })
    enterPin('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(session()).toMatchObject({ activeStaff: ALICE, locked: true })
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('never offers the unchecked carry-on for someone else, even when the server cannot be reached', async () => {
    mockSignIn.mockRejectedValue(new Error('Failed to fetch'))
    render(<LockScreen />)
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-2' } })
    enterPin()

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(session()).toMatchObject({ activeStaff: ALICE, locked: true })
  })

  it('never offers it for someone else when the till already knows the server is unreachable either', async () => {
    markUnreachable()
    render(<LockScreen />)
    expect(carryOnButton()).toBeInTheDocument() // for Alice, whose till it is
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    await screen.findByRole('combobox', { name: /staff member/i })
    expect(carryOnButton()).not.toBeInTheDocument()
  })

  it('never offers it for someone else whose PIN is locked out', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<LockScreen />)
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-2' } })
    enterPin()

    expect(await screen.findByRole('status')).toHaveTextContent(/locked after too many attempts/i)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(session()).toMatchObject({ activeStaff: ALICE, locked: true })
  })

  it('Back returns from the staff picker to the signed-in person\'s PIN', async () => {
    render(<LockScreen />)
    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /till locked/i })).toBeInTheDocument()
    expect(session().locked).toBe(true)
  })

  // ── Keys must not reach the pages underneath ───────────────────────────────
  it('keeps key presses away from window/document listeners (card scanner, Escape) while locked', () => {
    const onWindow = vi.fn()
    const onDocument = vi.fn()
    window.addEventListener('keydown', onWindow)
    document.addEventListener('keydown', onDocument)

    const { unmount } = render(<LockScreen />)
    fireEvent.keyDown(document.body, { key: '7' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: '1' }), { key: 'Escape' })
    expect(onWindow).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()

    unmount()
    fireEvent.keyDown(document.body, { key: '7' })
    expect(onWindow).toHaveBeenCalledTimes(1)
    expect(onDocument).toHaveBeenCalledTimes(1)

    window.removeEventListener('keydown', onWindow)
    document.removeEventListener('keydown', onDocument)
  })

  it('typing digits on a keyboard does not enter a PIN (a card scan must not burn PIN attempts)', () => {
    render(<LockScreen />)
    for (const key of ['1', '2', '3', '4']) fireEvent.keyDown(document.body, { key })
    expect(mockSignIn).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/PIN display/i).querySelectorAll('[data-filled="true"]')).toHaveLength(0)
  })
})
