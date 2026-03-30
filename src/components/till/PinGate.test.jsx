import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PinGate from './PinGate'
import { useSessionStore } from '../../stores/sessionStore'

// ── Supabase mock ──────────────────────────────────────────────────────────────
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────
const ACTIVE_STAFF = { id: 'staff-1', name: 'Alice' }

function renderGate(props = {}) {
  return render(
    <PinGate
      onConfirm={props.onConfirm ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
      label={props.label}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: ACTIVE_STAFF })
})

describe('PinGate', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders the active staff name', () => {
    renderGate()
    expect(screen.getByText(/alice/i)).toBeInTheDocument()
  })

  it('renders the action label when provided', () => {
    renderGate({ label: 'Void Order' })
    expect(screen.getByText(/void order/i)).toBeInTheDocument()
  })

  it('renders a default header when no label provided', () => {
    renderGate()
    expect(screen.getByRole('heading')).toHaveTextContent(/confirm identity/i)
  })

  it('renders 4 PIN dots initially all empty', () => {
    renderGate()
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('renders 12 numpad buttons', () => {
    renderGate()
    const numpadButtons = screen.getAllByRole('button').filter(
      btn =>
        /^[0-9]$/.test(btn.textContent) ||
        btn.getAttribute('aria-label') === 'Backspace' ||
        btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  // ── Numpad interaction ─────────────────────────────────────────────────────
  it('pressing digit fills a dot', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('backspace removes last digit', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /backspace/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('clear resets all digits', () => {
    renderGate()
    ;['1', '2', '3'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    fireEvent.click(screen.getByRole('button', { name: /clear pin/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Auto-submit & success path ─────────────────────────────────────────────
  it('auto-submits on 4th digit and calls onConfirm on success', async () => {
    const onConfirm = vi.fn()
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: ACTIVE_STAFF },
      error: null,
    })
    renderGate({ onConfirm })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234' },
      })
      expect(onConfirm).toHaveBeenCalledOnce()
    })
  })

  it('does NOT change the session store on success', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: ACTIVE_STAFF },
      error: null,
    })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    // Session must remain unchanged
    expect(useSessionStore.getState().activeStaff).toEqual(ACTIVE_STAFF)
  })

  // ── Failure path ───────────────────────────────────────────────────────────
  it('shows error and clears digits on invalid PIN', async () => {
    mockInvoke.mockResolvedValue({ data: { valid: false }, error: null })
    renderGate()
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('shows generic error on network failure', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  // ── Cancel ─────────────────────────────────────────────────────────────────
  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    renderGate({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // ── Verifying state ────────────────────────────────────────────────────────
  it('shows verifying indicator while awaiting response', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/verifying/i)).toBeInTheDocument()
  })
})
