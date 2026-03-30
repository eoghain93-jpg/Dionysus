import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CashPaymentModal from './CashPaymentModal'

describe('CashPaymentModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    onConfirm.mockClear()
    onCancel.mockClear()
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

  it('Done button on change step calls onConfirm', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Cancel button calls onCancel', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
