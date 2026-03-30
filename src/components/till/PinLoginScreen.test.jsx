import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PinLoginScreen from './PinLoginScreen'
import { useSessionStore } from '../../stores/sessionStore'

const { mockInvoke, mockFrom } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    functions: { invoke: mockInvoke },
  },
}))

const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

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

  it('auto-submits when 4 digits are entered with a staff member selected', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: { id: 'staff-1', name: 'Alice' } },
      error: null,
    })
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234' },
      })
    })
  })

  it('does not submit if no staff member is selected', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('on valid PIN calls setActiveStaff and clears digits', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: { id: 'staff-1', name: 'Alice' } },
      error: null,
    })
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
    mockInvoke.mockResolvedValue({ data: { valid: false }, error: null })
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

  it('on network error shows generic error message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  it('shows a loading indicator while verifying', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))
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
})
