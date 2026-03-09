import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DailySummary from '../DailySummary'

// Mock supabase
vi.mock('../../../lib/supabase', () => {
  const mockQuery = {
    select: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
  }
  // Chain the query builder
  mockQuery.select.mockReturnValue(mockQuery)
  mockQuery.gte.mockReturnValue(mockQuery)
  // lte returns a promise-like object (resolves with data)
  mockQuery.lte.mockResolvedValue({ data: [], error: null })

  return {
    supabase: {
      from: vi.fn(() => mockQuery),
    },
    __mockQuery: mockQuery,
  }
})

// Helper to configure the mock to resolve with specific orders
async function setupMock(orders) {
  const mod = await import('../../../lib/supabase')
  mod.__mockQuery.lte.mockResolvedValue({ data: orders, error: null })
}

const DATE = '2026-03-09'

const paidCash = { id: '1', total_amount: 10.00, payment_method: 'cash', status: 'paid' }
const paidCard = { id: '2', total_amount: 20.00, payment_method: 'card', status: 'paid' }
const paidTab  = { id: '3', total_amount: 5.50,  payment_method: 'tab',  status: 'paid' }
const voided   = { id: '4', total_amount: 8.00,  payment_method: 'cash', status: 'voided' }

describe('DailySummary', () => {
  beforeEach(async () => {
    // Reset to empty orders before each test
    await setupMock([])
  })

  it('shows total revenue for paid orders only', async () => {
    await setupMock([paidCash, paidCard, voided])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('total-revenue')).toHaveTextContent('£30.00')
    })
  })

  it('shows correct transaction count (paid orders only)', async () => {
    await setupMock([paidCash, paidCard, paidTab, voided])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('transaction-count')).toHaveTextContent('3')
    })
  })

  it('shows correct void count', async () => {
    await setupMock([paidCash, voided, { ...voided, id: '5' }])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('void-count')).toHaveTextContent('2')
    })
  })

  it('shows cash total from paid cash orders', async () => {
    await setupMock([paidCash, paidCard, paidTab])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('cash-total')).toHaveTextContent('£10.00')
    })
  })

  it('shows card total from paid card orders', async () => {
    await setupMock([paidCash, paidCard, paidTab])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('card-total')).toHaveTextContent('£20.00')
    })
  })

  it('shows tab total from paid tab orders', async () => {
    await setupMock([paidCash, paidCard, paidTab])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('tab-total')).toHaveTextContent('£5.50')
    })
  })

  it('shows zero revenue when there are no paid orders', async () => {
    await setupMock([voided])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('total-revenue')).toHaveTextContent('£0.00')
    })
  })

  it('shows zero void count when there are no voided orders', async () => {
    await setupMock([paidCash, paidCard])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('void-count')).toHaveTextContent('0')
    })
  })

  it('shows zero transaction count when no data', async () => {
    await setupMock([])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('transaction-count')).toHaveTextContent('0')
    })
  })

  it('shows breakdown sums correctly across multiple paid orders of same method', async () => {
    const cash1 = { id: 'a', total_amount: 5.00, payment_method: 'cash', status: 'paid' }
    const cash2 = { id: 'b', total_amount: 7.50, payment_method: 'cash', status: 'paid' }
    await setupMock([cash1, cash2])
    render(<DailySummary date={DATE} />)

    await waitFor(() => {
      expect(screen.getByTestId('cash-total')).toHaveTextContent('£12.50')
      expect(screen.getByTestId('card-total')).toHaveTextContent('£0.00')
      expect(screen.getByTestId('tab-total')).toHaveTextContent('£0.00')
    })
  })
})
