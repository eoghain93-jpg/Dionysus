import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockSignIn, mockFrom, mockInvoke } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockFrom: vi.fn(),
  mockInvoke: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: mockInvoke } },
}))
// signInStaff checks the PIN in the database and opens the new person's
// server session (ending the previous one on this till).
vi.mock('../../lib/audit/staff', () => ({ signInStaff: mockSignIn }))
vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

import SwitchUserModal from './SwitchUserModal'
import { useSessionStore } from '../../stores/sessionStore'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }
const STAFF = [
  { id: 'staff-1', name: 'Alice' },
  { id: 'staff-2', name: 'Bob Smith' },
]

async function pickBobAndEnter(pin = '2468') {
  fireEvent.click(await screen.findByRole('button', { name: /bob smith/i }))
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: ALICE, locked: false })
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: STAFF, error: null }),
  })
})

describe('SwitchUserModal', () => {
  it('lists the staff to switch to', async () => {
    render(<SwitchUserModal onClose={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /alice/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bob smith/i })).toBeInTheDocument()
  })

  it('signs the new person in through signInStaff and closes', async () => {
    const onClose = vi.fn()
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-2', name: 'Bob Smith' } })
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter('2468')

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(mockSignIn).toHaveBeenCalledTimes(1)
    expect(mockSignIn).toHaveBeenCalledWith('staff-2', '2468')
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-2', name: 'Bob Smith' })
    // not the edge function directly any more
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('logs nothing itself for a switch (the server records the sign-in)', async () => {
    const onClose = vi.fn()
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-2', name: 'Bob Smith' } })
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('leaves the open order as it is', async () => {
    const onClose = vi.fn()
    const items = [{ product_id: 'p1', name: 'Guinness', quantity: 2, unit_price: 5.2 }]
    useTillStore.setState({ orderItems: items })
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-2', name: 'Bob Smith' } })
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useTillStore.getState().orderItems).toEqual(items)
    useTillStore.setState({ orderItems: [] })
  })

  it('shows "Incorrect PIN" and keeps the current person on a wrong PIN', async () => {
    const onClose = vi.fn()
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 3 })
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter('0000')

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a lockout countdown, not "Incorrect PIN", and does not switch when the PIN is locked', async () => {
    const onClose = vi.fn()
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 90 })
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter()

    expect(await screen.findByRole('status')).toHaveTextContent(/PIN locked.*Try again in 1:30/)
    expect(screen.queryByText('Incorrect PIN')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows "Something went wrong" when the sign-in gives no answer at all', async () => {
    const onClose = vi.fn()
    mockSignIn.mockResolvedValue(null)
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter()

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so when the staff list cannot be loaded', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
    })
    render(<SwitchUserModal onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff/i)
  })

  it('shows "Something went wrong" when the server cannot be reached (signInStaff rejects)', async () => {
    const onClose = vi.fn()
    mockSignIn.mockRejectedValue(new Error('Failed to fetch'))
    render(<SwitchUserModal onClose={onClose} />)
    await pickBobAndEnter()

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(useSessionStore.getState().activeStaff).toEqual(ALICE)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the close button calls onClose without signing anyone in', async () => {
    const onClose = vi.fn()
    render(<SwitchUserModal onClose={onClose} />)
    await screen.findByRole('button', { name: /alice/i })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(mockSignIn).not.toHaveBeenCalled()
  })
})
