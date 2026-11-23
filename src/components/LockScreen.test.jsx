import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

const { mockVerify, mockSignIn, mockSetPin, mockFrom } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockSignIn: vi.fn(),
  mockSetPin: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: vi.fn() } },
}))
vi.mock('../lib/audit/staff', () => ({
  verifyStaffPin: mockVerify,
  signInStaff: mockSignIn,
  setStaffPin: mockSetPin,
}))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

import LockScreen from './LockScreen'
import { useSessionStore } from '../stores/sessionStore'
import { logEvent } from '../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }
const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

function enterPin(pin = '1234') {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
}

const session = () => useSessionStore.getState()
const carryOnButton = () => screen.queryByRole('button', { name: /carry on without checking the pin/i })

beforeEach(() => {
  vi.clearAllMocks()
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
  it('unlocks with the signed-in person\'s PIN, checked for the purpose "unlock"', async () => {
    mockVerify.mockResolvedValue({ valid: true, member: ALICE })
    render(<LockScreen />)
    enterPin('4821')

    await waitFor(() => expect(session().locked).toBe(false))
    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockVerify).toHaveBeenCalledWith('staff-1', '4821', 'unlock')
    expect(session().activeStaff).toEqual(ALICE)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', {}, { severity: 0 })
    // a re-check, not a new sign-in
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('stays locked on a wrong PIN and offers no way round it', async () => {
    mockVerify.mockResolvedValue({ valid: false, attemptsRemaining: 3 })
    render(<LockScreen />)
    enterPin('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(session().locked).toBe(true)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/PIN display/i).querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('shows the lockout countdown and disables the numpad when the PIN is locked out', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<LockScreen />)
    enterPin()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/locked after too many attempts/i)
    expect(status).toHaveTextContent(/15:00/)
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    expect(session().locked).toBe(true)
    expect(carryOnButton()).not.toBeInTheDocument()
    // someone else can still get in
    expect(screen.getByRole('button', { name: /someone else/i })).toBeEnabled()
  })

  it('points to "Someone else" when the signed-in person has no PIN', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'no_pin' })
    render(<LockScreen />)
    enterPin()
    expect(await screen.findByRole('alert')).toHaveTextContent(/no pin is set/i)
    expect(session().locked).toBe(true)
    expect(carryOnButton()).not.toBeInTheDocument()
  })

  // ── Never strand a working till ────────────────────────────────────────────
  it('does not offer to carry on unchecked before a PIN check has failed to reach the server', () => {
    render(<LockScreen />)
    expect(carryOnButton()).not.toBeInTheDocument()
  })

  it('offers "Carry on without checking the PIN" only after the check REJECTS, and records its use', async () => {
    mockVerify.mockRejectedValue(new Error('Failed to fetch'))
    render(<LockScreen />)
    enterPin()

    const button = await screen.findByRole('button', { name: /carry on without checking the pin/i })
    expect(session().locked).toBe(true) // offered, not done
    expect(logEvent).not.toHaveBeenCalled()

    fireEvent.click(button)

    expect(session().locked).toBe(false)
    expect(session().activeStaff).toEqual(ALICE) // the SAME person
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked_unverified', {}, { severity: 2 })
  })

  it('treats a PIN check that never answers as unreachable after 8 seconds (no endless "Verifying…")', async () => {
    vi.useFakeTimers()
    mockVerify.mockReturnValue(new Promise(() => {}))
    render(<LockScreen />)
    enterPin()

    await act(async () => { await vi.advanceTimersByTimeAsync(7_999) })
    expect(screen.getByText(/verifying/i)).toBeInTheDocument()
    expect(carryOnButton()).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument()
    expect(carryOnButton()).toBeInTheDocument()
    expect(session().locked).toBe(true)
    // the numpad works again for another try
    expect(screen.getByRole('button', { name: '5' })).toBeEnabled()
  })

  it('withdraws the offer as soon as the server answers again', async () => {
    mockVerify
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ valid: false, attemptsRemaining: 4 })
    render(<LockScreen />)

    enterPin()
    await screen.findByRole('button', { name: /carry on without checking the pin/i })

    enterPin('9999')
    await screen.findByText(/incorrect pin/i)
    expect(carryOnButton()).not.toBeInTheDocument()
    expect(session().locked).toBe(true)
  })

  it('a correct PIN after a failed check unlocks normally (verified, not "unverified")', async () => {
    mockVerify
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ valid: true })
    render(<LockScreen />)
    enterPin()
    await screen.findByRole('button', { name: /carry on without checking the pin/i })
    enterPin()

    await waitFor(() => expect(session().locked).toBe(false))
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.unlocked', {}, { severity: 0 })
  })

  it('a PIN check answered after the lock screen has gone does nothing', async () => {
    let resolve
    mockVerify
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockReturnValueOnce(new Promise(r => { resolve = r }))
    const { unmount } = render(<LockScreen />)
    enterPin()
    fireEvent.click(await screen.findByRole('button', { name: /carry on without checking the pin/i }))
    expect(session().locked).toBe(false)
    logEvent.mockClear()

    // a second check was started, the screen goes, the till is locked again
    act(() => session().lock())
    enterPin()
    unmount()
    await act(async () => { resolve({ valid: true }) })

    expect(session().locked).toBe(true)
    expect(logEvent).not.toHaveBeenCalled()
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
    expect(mockSignIn).toHaveBeenCalledWith('staff-2', '2468')
    expect(mockVerify).not.toHaveBeenCalled()
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
    expect(mockVerify).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/PIN display/i).querySelectorAll('[data-filled="true"]')).toHaveLength(0)
  })
})
