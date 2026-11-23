import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import PinGate from './PinGate'
import { useSessionStore } from '../../stores/sessionStore'
import { logEvent } from '../../lib/audit/log'

// ── Mocks ──────────────────────────────────────────────────────────────────────
// The PIN is checked by verifyStaffPin (database first, verify-pin as the
// fallback): it resolves with the verify-pin response shape and rejects only
// when the server cannot be reached.
const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }))

vi.mock('../../lib/audit/staff', () => ({ verifyStaffPin: mockVerify }))
vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

// ── Helpers ────────────────────────────────────────────────────────────────────
const ACTIVE_STAFF = { id: 'staff-1', name: 'Alice' }

function renderGate(props = {}) {
  return render(
    <PinGate
      onConfirm={props.onConfirm ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
      label={props.label}
      purpose={props.purpose}
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
    mockVerify.mockResolvedValue({ valid: true, member: ACTIVE_STAFF })
    renderGate({ onConfirm, purpose: 'z_report' })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockVerify).toHaveBeenCalledWith('staff-1', '1234', 'z_report')
      expect(onConfirm).toHaveBeenCalledOnce()
    })
    expect(mockVerify).toHaveBeenCalledTimes(1)
  })

  it('does NOT change the session store on success', async () => {
    mockVerify.mockResolvedValue({ valid: true, member: ACTIVE_STAFF })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockVerify).toHaveBeenCalled())
    // Session must remain unchanged
    expect(useSessionStore.getState().activeStaff).toEqual(ACTIVE_STAFF)
  })

  // ── Failure path ───────────────────────────────────────────────────────────
  it('shows error and clears digits on invalid PIN', async () => {
    mockVerify.mockResolvedValue({ valid: false, attemptsRemaining: 4 })
    renderGate()
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('shows generic error when the server cannot be reached (verifyStaffPin rejects)', async () => {
    const onConfirm = vi.fn()
    mockVerify.mockRejectedValue(new Error('Failed to fetch'))
    renderGate({ onConfirm })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    // a privileged action is never let through unchecked
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not confirm on a wrong PIN', async () => {
    const onConfirm = vi.fn()
    mockVerify.mockResolvedValue({ valid: false, attemptsRemaining: 1 })
    renderGate({ onConfirm })
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await screen.findByRole('alert')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('sends the PIN once even if the parent re-renders with a new onConfirm mid-check', async () => {
    let resolve
    mockVerify.mockReturnValue(new Promise(r => { resolve = r }))
    const { rerender } = render(<PinGate onConfirm={() => {}} onCancel={() => {}} label="Fix Payment" />)
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await screen.findByText(/verifying/i)

    const onConfirm = vi.fn()
    rerender(<PinGate onConfirm={() => {}} onCancel={() => {}} label="Fix Payment" />)
    rerender(<PinGate onConfirm={onConfirm} onCancel={() => {}} label="Fix Payment" />)

    expect(mockVerify).toHaveBeenCalledTimes(1)
    resolve({ valid: true })
    // the newest onConfirm is the one called
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  })

  // ── Purpose ────────────────────────────────────────────────────────────────
  it('passes the purpose prop to the PIN check', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    renderGate({ purpose: 'price_change', label: 'Confirm Price Change' })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('staff-1', '1234', 'price_change'))
  })

  it('derives the purpose from the label when none is given', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    renderGate({ label: 'Undo Tab Payment — £12.50' })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('staff-1', '1234', 'undo_tab_payment_12_50'))
  })

  it('falls back to "confirm" with neither purpose nor label', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('staff-1', '1234', 'confirm'))
  })

  // ── Cancel ─────────────────────────────────────────────────────────────────
  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    renderGate({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('logs pin_gate.cancelled with the purpose when cancelled', () => {
    const onCancel = vi.fn()
    renderGate({ onCancel, purpose: 'fix_payment' })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('pin_gate.cancelled', { purpose: 'fix_payment' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('logs the cancel from the dismiss (X) button too, with a purpose derived from the label', () => {
    const onCancel = vi.fn()
    renderGate({ onCancel, label: 'Void Order' })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(logEvent).toHaveBeenCalledWith('pin_gate.cancelled', { purpose: 'void_order' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not confirm when cancelled while the PIN check is still in flight', async () => {
    let resolve
    mockVerify.mockReturnValue(new Promise(r => { resolve = r }))
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderGate({ onConfirm, onCancel, purpose: 'price_change' })
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await screen.findByText(/verifying/i)

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await act(async () => { resolve({ valid: true }) })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(logEvent).toHaveBeenCalledWith('pin_gate.cancelled', { purpose: 'price_change' })
  })

  it('logs nothing itself for a checked PIN (the server records those)', async () => {
    mockVerify.mockResolvedValueOnce({ valid: false }).mockResolvedValueOnce({ valid: true })
    const onConfirm = vi.fn()
    renderGate({ onConfirm, purpose: 'z_report' })
    ;['9', '9', '9', '9'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await screen.findByRole('alert')
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(logEvent).not.toHaveBeenCalled()
  })

  // ── Lockout ────────────────────────────────────────────────────────────────
  it('shows a calm countdown message when the PIN is locked', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/locked after too many attempts/i)
    expect(status).toHaveTextContent(/15:00/)
    // not styled as an error — no alert role
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the numpad while locked', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear pin/i })).toBeDisabled()
  })

  it('still allows cancelling while locked', async () => {
    const onCancel = vi.fn()
    mockVerify.mockResolvedValue({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
    renderGate({ onCancel })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // ── Verifying state ────────────────────────────────────────────────────────
  it('shows verifying indicator while awaiting response', async () => {
    mockVerify.mockReturnValue(new Promise(() => {}))
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/verifying/i)).toBeInTheDocument()
  })
})
