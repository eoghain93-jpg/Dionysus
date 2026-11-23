import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetPinModal from './SetPinModal'

// ── Mock ───────────────────────────────────────────────────────────────────────
// setStaffPin sets the PIN in the database (verify-pin 'set' mode is its
// fallback) and resolves with { success: true } or { error, reason? }.
const { mockSetPin } = vi.hoisted(() => ({ mockSetPin: vi.fn() }))

vi.mock('../../lib/audit/staff', () => ({ setStaffPin: mockSetPin }))

const STAFF_MEMBER = { id: 'staff-1', name: 'Alice', membership_tier: 'staff' }

function renderModal(props = {}) {
  return render(
    <SetPinModal
      member={props.member ?? STAFF_MEMBER}
      onClose={props.onClose ?? vi.fn()}
      onSaved={props.onSaved ?? vi.fn()}
      requireCurrentPin={props.requireCurrentPin}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SetPinModal', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders a heading with the member name', () => {
    renderModal()
    expect(screen.getByRole('heading')).toHaveTextContent(/alice/i)
  })

  it('renders step 1 prompt initially', () => {
    renderModal()
    expect(screen.getByText(/enter new pin/i)).toBeInTheDocument()
  })

  it('renders 12 numpad buttons', () => {
    renderModal()
    const numpadButtons = screen.getAllByRole('button').filter(
      btn =>
        /^[0-9]$/.test(btn.textContent) ||
        btn.getAttribute('aria-label') === 'Backspace' ||
        btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  it('renders 4 empty PIN dots on mount', () => {
    renderModal()
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Step 1 — enter new PIN ─────────────────────────────────────────────────
  it('advances to step 2 after 4 digits entered in step 1', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(screen.getByText(/confirm new pin/i)).toBeInTheDocument()
    })
  })

  it('clears dots when advancing to step 2', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Step 2 — confirm PIN ───────────────────────────────────────────────────
  it('shows mismatch error when confirmation does not match', async () => {
    renderModal()
    // Step 1: enter 1234
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    // Step 2: enter 5678
    ;['5', '6', '7', '8'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/pins do not match/i)
  })

  it('goes back to step 1 after a mismatch', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(screen.getByText(/enter new pin/i)).toBeInTheDocument()
    })
  })

  // ── Matching PINs — sets the PIN ───────────────────────────────────────────
  it('calls setStaffPin when PINs match (no current PIN for a first PIN)', async () => {
    mockSetPin.mockResolvedValue({ success: true })
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockSetPin).toHaveBeenCalledWith('staff-1', '1234', undefined)
    })
    expect(mockSetPin).toHaveBeenCalledTimes(1)
  })

  it('sends the current PIN when changing an existing one', async () => {
    mockSetPin.mockResolvedValue({ success: true })
    renderModal({ requireCurrentPin: true })
    expect(screen.getByText(/enter current pin/i)).toBeInTheDocument()
    ;['9', '8', '7', '6'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => screen.getByText(/enter new pin/i))
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => {
      expect(mockSetPin).toHaveBeenCalledWith('staff-1', '1234', '9876')
    })
  })

  it('shows the error and starts again when the current PIN is refused', async () => {
    const onSaved = vi.fn()
    mockSetPin.mockResolvedValue({ error: 'Incorrect current PIN' })
    renderModal({ requireCurrentPin: true, onSaved })
    ;['0', '0', '0', '0'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => screen.getByText(/enter new pin/i))
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to set pin/i)
    expect(screen.getByText(/enter current pin/i)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows success message and calls onSaved after successful set', async () => {
    const onSaved = vi.fn()
    mockSetPin.mockResolvedValue({ success: true })
    renderModal({ onSaved })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/pin set successfully/i)).toBeInTheDocument()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce(), { timeout: 2500 })
  })

  it('shows error message when the PIN could not be set', async () => {
    mockSetPin.mockResolvedValue({ error: 'Server error' })
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to set pin/i)
  })

  it('shows error message when setStaffPin rejects', async () => {
    mockSetPin.mockRejectedValue(new Error('Failed to fetch'))
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to set pin/i)
  })

  // ── Cancel / close ─────────────────────────────────────────────────────────
  it('Cancel button calls onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
