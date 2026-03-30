import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetPinModal from './SetPinModal'

// ── Supabase mock ──────────────────────────────────────────────────────────────
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}))

const STAFF_MEMBER = { id: 'staff-1', name: 'Alice', membership_tier: 'staff' }

function renderModal(props = {}) {
  return render(
    <SetPinModal
      member={props.member ?? STAFF_MEMBER}
      onClose={props.onClose ?? vi.fn()}
      onSaved={props.onSaved ?? vi.fn()}
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

  // ── Matching PINs — calls edge function ────────────────────────────────────
  it('calls verify-pin with set mode when PINs match', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null })
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234', mode: 'set' },
      })
    })
  })

  it('shows success message and calls onSaved after successful set', async () => {
    const onSaved = vi.fn()
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null })
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

  it('shows error message on edge function failure', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Server error' } })
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
