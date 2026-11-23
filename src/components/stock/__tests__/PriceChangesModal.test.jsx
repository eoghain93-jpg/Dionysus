import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import PriceChangesModal from '../PriceChangesModal'
import { fetchPriceChanges } from '../../../lib/priceChanges'
import { logEvent } from '../../../lib/audit/log'

vi.mock('../../../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../../../lib/priceChanges', () => ({ fetchPriceChanges: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('PriceChangesModal — audit', () => {
  it('logs that the price log was looked at, once it is on screen', async () => {
    let finish
    fetchPriceChanges.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<PriceChangesModal onClose={vi.fn()} />)
    expect(logEvent).not.toHaveBeenCalled()
    await act(async () => { finish([]) })
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['report.viewed', { report: 'price_changes' }],
    ])
  })

  it('logs nothing when the price log fails to load', async () => {
    fetchPriceChanges.mockRejectedValue(new Error('permission denied'))
    render(<PriceChangesModal onClose={vi.fn()} />)
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
  })
})
