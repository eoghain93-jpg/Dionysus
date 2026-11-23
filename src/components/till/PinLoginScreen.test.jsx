import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import PinLoginScreen from './PinLoginScreen'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'

const { mockSignIn, mockSetPin, mockFrom } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSetPin: vi.fn(),
  mockFrom: vi.fn(),
}))

// The staff list still comes straight from the members table ...
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    functions: { invoke: vi.fn() },
  },
}))

// ... but the PIN is checked by signInStaff (database first, verify-pin as
// the fallback), which resolves with the verify-pin response shape and
// rejects only when the server cannot be reached.
vi.mock('../../lib/audit/staff', () => ({
  signInStaff: mockSignIn,
  setStaffPin: mockSetPin,
}))

const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

async function selectStaffAndEnterPin(pin = '1234') {
  fireEvent.change(await screen.findByRole('combobox', { name: /staff member/i }), {
    target: { value: 'staff-1' },
  })
  for (const d of pin) {
    fireEvent.click(screen.getByRole('button', { name: d }))
  }
}

function setupFromMock(staffList = STAFF) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: staffList, error: null }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: null })
  setupFromMock()
})

describe('PinLoginScreen', () => {
  it('renders a staff selector', async () => {
    render(<PinLoginScreen />)
    expect(await screen.findByRole('combobox', { name: /staff member/i })).toBeInTheDocument()
  })

  it('populates the dropdown with staff members from Supabase', async () => {
    render(<PinLoginScreen />)
    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument()
  })

  it('renders 12 numpad buttons', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    const numpadButtons = screen.getAllByRole('button').filter(
      btn => /^[0-9]$/.test(btn.textContent) || btn.getAttribute('aria-label') === 'Backspace' || btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  it('renders 4 PIN dots initially all empty', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('pressing digit fills a dot', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(3)
  })

  it('backspace removes the last digit', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /backspace/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('clear resets all digits', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: /clear pin/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('cannot enter more than 4 digits', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    ;['1', '2', '3', '4', '5'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(4)
  })

  it('auto-submits to signInStaff when 4 digits are entered with a staff member selected', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-1', name: 'Alice' } })
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('staff-1', '1234')
    })
    expect(mockSignIn).toHaveBeenCalledTimes(1)
  })

  it('never calls the verify-pin edge function itself', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-1', name: 'Alice' } })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin()
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('does not submit if no staff member is selected', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('on valid PIN calls setActiveStaff and clears digits', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: { id: 'staff-1', name: 'Alice' } })
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-1', name: 'Alice' })
    })
  })

  it('on invalid PIN shows error message and clears digits', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 4 })
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('shows a generic error when the server cannot be reached (signInStaff rejects)', async () => {
    mockSignIn.mockRejectedValue(new Error('Failed to fetch'))
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  it('shows a loading indicator while verifying', async () => {
    mockSignIn.mockReturnValue(new Promise(() => {}))
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/verifying/i)).toBeInTheDocument()
  })

  it('shows a message when no staff members exist', async () => {
    setupFromMock([])
    render(<PinLoginScreen />)
    expect(await screen.findByText(/no staff members/i)).toBeInTheDocument()
  })

  it('shows an error message when the staff fetch fails', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Network error' } }),
    })
    render(<PinLoginScreen />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff/i)
  })

  // ── Lockout ────────────────────────────────────────────────────────────────
  it('shows a calm countdown message when the PIN is locked', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/locked after too many attempts/i)
    expect(status).toHaveTextContent(/15:00/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the numpad while locked and does not log anyone in', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin()
    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  it('does not sign anyone in on a wrong PIN', async () => {
    mockSignIn.mockResolvedValue({ valid: false, attemptsRemaining: 2 })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin('9999')
    await screen.findByRole('alert')
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  // ── First PIN ──────────────────────────────────────────────────────────────
  it('offers to set a PIN when the person has none yet (no_pin)', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'no_pin' })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin()
    expect(await screen.findByRole('dialog')).toHaveTextContent(/set pin — alice/i)
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  it('sets the first PIN through setStaffPin, then returns to the login', async () => {
    mockSignIn.mockResolvedValue({ valid: false, reason: 'no_pin' })
    mockSetPin.mockResolvedValue({ success: true })
    render(<PinLoginScreen />)
    await selectStaffAndEnterPin()

    const dialog = within(await screen.findByRole('dialog'))
    const enter = pin => { for (const d of pin) fireEvent.click(dialog.getByRole('button', { name: d })) }
    enter('4821')
    await dialog.findByText(/confirm new pin/i)
    enter('4821')

    await waitFor(() => expect(mockSetPin).toHaveBeenCalledWith('staff-1', '4821', undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 2500 })
    // setting a PIN does not sign anyone in: they now enter it
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  // ── Used from the lock screen ("Someone else") ─────────────────────────────
  it('shows no Back button on its own', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
  })

  it('shows a Back button when onBack is given', async () => {
    const onBack = vi.fn()
    render(<PinLoginScreen onBack={onBack} />)
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onSignedIn after a successful sign-in only', async () => {
    const onSignedIn = vi.fn()
    mockSignIn.mockResolvedValueOnce({ valid: false })
    const { unmount } = render(<PinLoginScreen onSignedIn={onSignedIn} />)
    await selectStaffAndEnterPin('9999')
    await screen.findByRole('alert')
    expect(onSignedIn).not.toHaveBeenCalled()
    unmount()

    mockSignIn.mockResolvedValueOnce({ valid: true, member: { id: 'staff-1', name: 'Alice' } })
    render(<PinLoginScreen onSignedIn={onSignedIn} />)
    await selectStaffAndEnterPin('1234')
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ id: 'staff-1', name: 'Alice' }))
  })

  it('sends the PIN once even if the parent re-renders with a new callback mid-check', async () => {
    let resolve
    mockSignIn.mockReturnValue(new Promise(r => { resolve = r }))
    const { rerender } = render(<PinLoginScreen onSignedIn={() => {}} />)
    await selectStaffAndEnterPin()
    await screen.findByText(/verifying/i)

    rerender(<PinLoginScreen onSignedIn={() => {}} />)
    rerender(<PinLoginScreen onSignedIn={() => {}} />)

    expect(mockSignIn).toHaveBeenCalledTimes(1)
    resolve({ valid: false })
    await screen.findByRole('alert')
  })
})
