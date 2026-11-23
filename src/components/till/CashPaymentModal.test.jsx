import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CashPaymentModal from './CashPaymentModal'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

describe('CashPaymentModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    onConfirm.mockClear()
    onCancel.mockClear()
    logEvent.mockClear()
  })

  it('displays the order total', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText('£7.50')).toBeInTheDocument()
  })

  it('confirm button is disabled when nothing entered', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('quick-select £10 sets tendered amount and enables confirm', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(screen.getByText('£10.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
  })

  it('quick-select below total keeps confirm disabled', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£5' }))
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('shows £0.00 change on exact tender', () => {
    render(<CashPaymentModal total={10.00} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(screen.getByText('£0.00')).toBeInTheDocument()
  })

  it('shows correct change when tendered exceeds total', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(screen.getByText('£2.50')).toBeInTheDocument()
  })

  it('numpad builds amount digit by digit', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByText('£10.00')).toBeInTheDocument()
  })

  it('backspace removes last digit', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('£1.00')).toBeInTheDocument()
  })

  it('confirming transitions to change-due step', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.getByText(/give change/i)).toBeInTheDocument()
    expect(screen.getByText('£2.50')).toBeInTheDocument()
  })

  it('Confirm button fires onConfirm immediately (so receipt + drawer happen during change-giving)', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Done button on change step calls onDone (or onCancel fallback)', () => {
    const onDone = vi.fn()
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onDone).toHaveBeenCalledOnce()
    // onConfirm only fires once (on Confirm), not again on Done
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Done button falls back to onCancel when onDone not provided', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Cancel button calls onCancel', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // ── audit ──────────────────────────────────────────────────────────────

  it('logs what was tendered and the change given, after firing the checkout', () => {
    const order = []
    onConfirm.mockImplementationOnce(() => { order.push('checkout') })
    logEvent.mockImplementationOnce(() => { order.push('log') })
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(logEvent.mock.calls).toEqual([
      ['sale.cash_tendered', { total: 7.5, tendered: 10, change: 2.5 }],
    ])
    expect(order).toEqual(['checkout', 'log'])
  })

  it('logs pence exactly for a keyed amount', () => {
    render(<CashPaymentModal total={4.35} onConfirm={onConfirm} onCancel={onCancel} />)
    for (const key of ['5', '.', '0', '5']) fireEvent.click(screen.getByRole('button', { name: key }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(logEvent.mock.calls[0][1]).toEqual({ total: 4.35, tendered: 5.05, change: 0.7 })
  })

  it('carries the caller\'s context (a tab payment is not a sale)', () => {
    render(
      <CashPaymentModal
        total={20}
        onConfirm={onConfirm}
        onCancel={onCancel}
        auditDetail={{ tab_payment: true, member_id: 'm1' }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '£20' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(logEvent.mock.calls[0][1]).toEqual({
      total: 20, tendered: 20, change: 0, tab_payment: true, member_id: 'm1',
    })
  })

  it('logs nothing when the modal is cancelled or Done is pressed', () => {
    const { unmount } = render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(logEvent).not.toHaveBeenCalled()
    unmount()

    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(logEvent).toHaveBeenCalledOnce()
  })
})
