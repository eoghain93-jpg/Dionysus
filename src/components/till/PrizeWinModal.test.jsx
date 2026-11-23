import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PrizeWinModal from './PrizeWinModal'
import { recordPrizeWin } from '../../lib/prizeWins'
import { openDrawer } from '../../lib/starPrinter'
import { useSessionStore } from '../../stores/sessionStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../../lib/prizeWins', () => ({ recordPrizeWin: vi.fn() }))
vi.mock('../../lib/starPrinter', () => ({ openDrawer: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Sam' } })
  recordPrizeWin.mockResolvedValue(undefined)
  openDrawer.mockResolvedValue(undefined)
})

function record() {
  const onSaved = vi.fn()
  render(<PrizeWinModal onClose={vi.fn()} onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText(/voucher amount/i), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Machine 1' }))
  fireEvent.submit(screen.getByLabelText(/voucher amount/i).closest('form'))
  return { onSaved }
}

describe('PrizeWinModal — audit', () => {
  it('logs nothing itself when the payout is recorded and the drawer opens (the row is the record)', async () => {
    const { onSaved } = record()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(recordPrizeWin).toHaveBeenCalledOnce()
    expect(openDrawer).toHaveBeenCalledOnce()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs the drawer failing to open, and still finishes', async () => {
    openDrawer.mockRejectedValue(new Error('Bridge returned 502'))
    const { onSaved } = record()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['drawer.open_failed', { source: 'prize_win', message: 'Bridge returned 502' }, { severity: 1 }],
    ])
  })

  it('logs nothing when the payout could not be recorded (drawer never tried)', async () => {
    recordPrizeWin.mockRejectedValue(new Error('offline'))
    const { onSaved } = record()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(openDrawer).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })
})
