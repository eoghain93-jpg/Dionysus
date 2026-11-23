import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

const { mockVerify, mockSignIn, mockFrom } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockSignIn: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: vi.fn() } },
}))
vi.mock('../lib/audit/staff', () => ({
  verifyStaffPin: mockVerify,
  signInStaff: mockSignIn,
  setStaffPin: vi.fn(),
}))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

import StaffGate from './StaffGate'
import { useSessionStore } from '../stores/sessionStore'
import { useTillStore } from '../stores/tillStore'
import { logEvent } from '../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }
const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

// Stands in for a page: something visible, something clickable, and some
// half-entered local state that a lock must not lose.
function Page() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <h1>Stock page</h1>
      <a href="/members">Members</a>
      <button onClick={() => setCount(c => c + 1)}>Counted {count}</button>
      <input aria-label="Notes" defaultValue="" />
    </div>
  )
}

function renderGate() {
  return render(<StaffGate><Page /></StaffGate>)
}

function enterPin(pin = '1234') {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
}

const session = () => useSessionStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useSessionStore.setState({ activeStaff: null, locked: false })
  useTillStore.setState({ membersOnlyMode: false })
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

describe('StaffGate — nobody signed in', () => {
  it('shows the PIN login and nothing of the app', async () => {
    renderGate()
    expect(screen.getByRole('heading', { name: /staff login/i })).toBeInTheDocument()
    expect(screen.queryByText('Stock page')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('staff-gate-content')).not.toBeInTheDocument()
    await screen.findByRole('combobox', { name: /staff member/i })
  })

  it('opens once someone signs in with their PIN', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: ALICE })
    renderGate()
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-1' } })
    enterPin('4821')

    expect(await screen.findByText('Stock page')).toBeVisible()
    expect(mockSignIn).toHaveBeenCalledWith('staff-1', '4821')
    expect(screen.queryByRole('heading', { name: /staff login/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toBeVisible()
  })

  it('stays closed on a wrong PIN', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 4 })
    renderGate()
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-1' } })
    enterPin('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(screen.queryByText('Stock page')).not.toBeInTheDocument()
  })

  it('closes again when the session is cleared (sign out, Close Day)', async () => {
    useSessionStore.setState({ activeStaff: ALICE })
    renderGate()
    expect(screen.getByText('Stock page')).toBeVisible()

    act(() => session().clearSession())

    expect(screen.queryByText('Stock page')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /staff login/i })).toBeInTheDocument()
    await screen.findByRole('combobox', { name: /staff member/i })
  })

  it('switches members-only pricing off on sign-out so the next person does not inherit it', async () => {
    useSessionStore.setState({ activeStaff: ALICE })
    useTillStore.setState({ membersOnlyMode: true })
    renderGate()
    expect(useTillStore.getState().membersOnlyMode).toBe(true) // untouched while signed in

    act(() => session().clearSession())

    expect(useTillStore.getState().membersOnlyMode).toBe(false)
    // the log saw it go on, so it is told it went off by itself
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('pricing.members_only_mode_off', { reason: 'staff_signed_out' }, { severity: 1 })
    await screen.findByRole('combobox', { name: /staff member/i })
  })

  it('logs nothing about members-only pricing when it was not on', async () => {
    useSessionStore.setState({ activeStaff: ALICE })
    renderGate()
    act(() => session().clearSession())
    expect(logEvent).not.toHaveBeenCalled()
    await screen.findByRole('combobox', { name: /staff member/i })
  })

  it('leaves members-only pricing alone through a lock and unlock', () => {
    useSessionStore.setState({ activeStaff: ALICE })
    useTillStore.setState({ membersOnlyMode: true })
    renderGate()
    act(() => session().lock())
    act(() => session().unlock())
    expect(useTillStore.getState().membersOnlyMode).toBe(true)
    expect(logEvent).not.toHaveBeenCalled()
    useTillStore.setState({ membersOnlyMode: false })
  })
})

describe('StaffGate — signed in', () => {
  beforeEach(() => {
    useSessionStore.setState({ activeStaff: ALICE, locked: false })
  })

  it('shows the app with no login or lock screen in the way', () => {
    renderGate()
    expect(screen.getByText('Stock page')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: /till locked/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /staff login/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-gate-content')).not.toHaveAttribute('inert')
    expect(screen.getByTestId('staff-gate-content')).not.toHaveAttribute('aria-hidden')
  })

  it('when locked: the lock screen shows, and the page is hidden and inert', () => {
    renderGate()
    act(() => session().lock())

    expect(screen.getByRole('dialog', { name: /till locked/i })).toBeInTheDocument()
    const content = screen.getByTestId('staff-gate-content')
    expect(content).toHaveAttribute('inert')
    expect(content).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Stock page')).not.toBeVisible()
    // hidden from the accessibility tree: no page controls can be found
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /counted/i })).not.toBeInTheDocument()
  })

  it('keeps the signed-in person, and whatever was half-done on the page, through a lock', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Counted 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Counted 1' }))
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'three kegs short' } })

    act(() => session().lock())
    expect(session().activeStaff).toEqual(ALICE)
    enterPin('4821')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /till locked/i })).not.toBeInTheDocument())
    expect(mockVerify).toHaveBeenCalledWith('staff-1', '4821', 'unlock')
    expect(screen.getByRole('button', { name: 'Counted 2' })).toBeVisible()
    expect(screen.getByLabelText('Notes')).toHaveValue('three kegs short')
    expect(session()).toMatchObject({ activeStaff: ALICE, locked: false })
  })

  it('stays locked on a wrong PIN', async () => {
    mockVerify.mockResolvedValue({ valid: false, attemptsRemaining: 2 })
    renderGate()
    act(() => session().lock())
    enterPin('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(screen.getByText('Stock page')).not.toBeVisible()
    expect(session().locked).toBe(true)
  })

  it('"Someone else" signs a different person in and opens the till, page state intact', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-2', name: 'Bob' } })
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Counted 0' }))
    act(() => session().lock())

    fireEvent.click(screen.getByRole('button', { name: /someone else/i }))
    fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), { target: { value: 'staff-2' } })
    enterPin('2468')

    await waitFor(() => expect(session().activeStaff).toEqual({ id: 'staff-2', name: 'Bob' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /till locked/i })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Counted 1' })).toBeVisible()
  })
})

describe('StaffGate — idle lock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSessionStore.setState({ activeStaff: ALICE, locked: false })
  })

  it('locks after 5 idle minutes by default and logs it', () => {
    renderGate()
    act(() => { vi.advanceTimersByTime(5 * 60_000 - 1) })
    expect(screen.queryByRole('dialog', { name: /till locked/i })).not.toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('dialog', { name: /till locked/i })).toBeInTheDocument()
    expect(screen.getByText('Stock page')).not.toBeVisible()
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'idle', minutes: 5 }, { severity: 0 })
  })

  it('using the till keeps it open', () => {
    renderGate()
    for (let minute = 0; minute < 30; minute += 1) {
      act(() => { vi.advanceTimersByTime(60_000) })
      fireEvent.pointerDown(screen.getByRole('button', { name: /counted/i }))
    }
    expect(session().locked).toBe(false)
  })

  it('idle_lock_minutes = 0 never locks', () => {
    localStorage.setItem('idle_lock_minutes', '0')
    renderGate()
    act(() => { vi.advanceTimersByTime(8 * 60 * 60_000) })
    expect(session().locked).toBe(false)
    expect(screen.getByText('Stock page')).toBeVisible()
  })

  it('runs no idle timer while nobody is signed in', async () => {
    useSessionStore.setState({ activeStaff: null })
    renderGate()
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000) })
    expect(session().locked).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('after unlocking, the idle clock starts again from zero', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    renderGate()
    act(() => { vi.advanceTimersByTime(5 * 60_000) })
    expect(session().locked).toBe(true)

    // an hour passes at the lock screen, then the PIN is entered
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    enterPin()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(session().locked).toBe(false)

    act(() => { vi.advanceTimersByTime(5 * 60_000 - 1) })
    expect(session().locked).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(session().locked).toBe(true)
  })
})
