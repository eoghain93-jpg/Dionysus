import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CashbackModal from './CashbackModal'
import { recordCashback } from '../../lib/cashback'
import { openDrawer } from '../../lib/starPrinter'
import { useSessionStore } from '../../stores/sessionStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../../lib/cashback', () => ({ recordCashback: vi.fn() }))
vi.mock('../../lib/starPrinter', () => ({ openDrawer: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Sam' } })
  recordCashback.mockResolvedValue(undefined)
  openDrawer.mockResolvedValue(undefined)
})

function record(amount = '20') {
  const onSaved = vi.fn()
  render(<CashbackModal onClose={vi.fn()} onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: amount } })
  fireEvent.click(screen.getByRole('button', { name: 'Record' }))
  return { onSaved }
}

describe('CashbackModal — audit', () => {
  it('logs nothing itself when cashback is recorded and the drawer opens (the row is the record)', async () => {
    const { onSaved } = record()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(recordCashback).toHaveBeenCalledWith(20, 'staff-1')
    expect(openDrawer).toHaveBeenCalledOnce()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs the drawer failing to open, and still finishes', async () => {
    openDrawer.mockRejectedValue(new Error('Bridge returned 502'))
    const { onSaved } = record()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['drawer.open_failed', { source: 'cashback', message: 'Bridge returned 502' }, { severity: 1 }],
    ])
  })

  it('logs nothing when the cashback could not be recorded (drawer never tried)', async () => {
    recordCashback.mockRejectedValue(new Error('offline'))
    const { onSaved } = record()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(openDrawer).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })
})
