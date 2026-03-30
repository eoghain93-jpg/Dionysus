import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ZReportModal from './ZReportModal'

// Mock fetchZReportData
vi.mock('../../lib/zReport', () => ({
  fetchZReportData: vi.fn(),
}))

// Mock supabase (for Close Day insert and edge function call)
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
    functions: {
      invoke: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

// Mock sessionStore
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ clearSession: vi.fn() })),
  },
}))

import { fetchZReportData } from '../../lib/zReport'

const REPORT_DATA = {
  salesSummary: {
    totalRevenue: 450.00,
    transactionCount: 38,
    cashTotal: 120.00,
    cardTotal: 280.00,
    tabTotal: 50.00,
    refundsTotal: 15.00,
    netRevenue: 435.00,
  },
  topProducts: [
    { name: 'Guinness', qty: 42, revenue: 168.00 },
    { name: 'Lager',    qty: 30, revenue: 90.00 },
  ],
}

const DATE = '2026-03-30'

beforeEach(() => {
  vi.clearAllMocks()
  fetchZReportData.mockResolvedValue(REPORT_DATA)
})

// ---- Loading state ----

describe('ZReportModal — loading', () => {
  it('shows loading indicator while fetching', () => {
    fetchZReportData.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ---- Error state ----

describe('ZReportModal — error', () => {
  it('shows error message when fetch fails', async () => {
    fetchZReportData.mockRejectedValue(new Error('DB error'))
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/DB error/i)).toBeInTheDocument()
    })
  })
})

// ---- Sales Summary section ----

describe('ZReportModal — Sales Summary', () => {
  it('displays total revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-total-revenue')).toHaveTextContent('£450.00')
    })
  })

  it('displays transaction count', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-transaction-count')).toHaveTextContent('38')
    })
  })

  it('displays cash total', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-cash-total')).toHaveTextContent('£120.00')
    })
  })

  it('displays card total', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-card-total')).toHaveTextContent('£280.00')
    })
  })

  it('displays tab total', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-tab-total')).toHaveTextContent('£50.00')
    })
  })

  it('displays refunds total as negative', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-refunds-total')).toHaveTextContent('-£15.00')
    })
  })

  it('displays net revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-net-revenue')).toHaveTextContent('£435.00')
    })
  })
})

// ---- Top Products section ----

describe('ZReportModal — Top Products', () => {
  it('renders each product name', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('Lager')).toBeInTheDocument()
    })
  })

  it('renders each product quantity', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-product-qty-0')).toHaveTextContent('42')
      expect(screen.getByTestId('z-product-qty-1')).toHaveTextContent('30')
    })
  })

  it('renders each product revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-product-revenue-0')).toHaveTextContent('£168.00')
    })
  })

  it('shows empty state when no products', async () => {
    fetchZReportData.mockResolvedValue({ ...REPORT_DATA, topProducts: [] })
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/no product sales/i)).toBeInTheDocument()
    })
  })
})

// ---- Cash Reconciliation section ----

describe('ZReportModal — Cash Reconciliation', () => {
  it('renders opening float input defaulting to 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText(/opening float/i)).toHaveValue(0)
    })
  })

  it('renders actual cash input defaulting to 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText(/actual cash/i)).toHaveValue(0)
    })
  })

  it('expectedInTill = openingFloat + cashSales', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      // opening float = 0, cashSales = 120.00
      expect(screen.getByTestId('z-expected-till')).toHaveTextContent('£120.00')
    })
    fireEvent.change(screen.getByLabelText(/opening float/i), { target: { value: '50' } })
    expect(screen.getByTestId('z-expected-till')).toHaveTextContent('£170.00')
  })

  it('variance is expectedInTill - actualCash', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-variance')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/actual cash/i), { target: { value: '115' } })
    // actual=115, expected=120, variance = actual - expected = -5.00
    expect(screen.getByTestId('z-variance')).toHaveTextContent('-£5.00')
  })

  it('variance has green styling when >= 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-variance'))
    fireEvent.change(screen.getByLabelText(/actual cash/i), { target: { value: '120' } })
    expect(screen.getByTestId('z-variance')).toHaveClass('text-green-400')
  })

  it('variance has red styling when < 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-variance'))
    fireEvent.change(screen.getByLabelText(/actual cash/i), { target: { value: '100' } })
    expect(screen.getByTestId('z-variance')).toHaveClass('text-red-400')
  })
})

// ---- Close button ----

describe('ZReportModal — Close (X) button', () => {
  it('calls onClose when X button clicked', async () => {
    const onClose = vi.fn()
    render(<ZReportModal date={DATE} onClose={onClose} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-total-revenue'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ---- Export CSV ----

describe('ZReportModal — Export CSV', () => {
  it('Export CSV button is present after data loads', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
    })
  })
})

// ---- Close Day ----

describe('ZReportModal — Close Day', () => {
  it('Close Day button is present after data loads', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close day/i })).toBeInTheDocument()
    })
  })

  it('Close Day upserts into z_reports with correct date and floats', async () => {
    const { supabase } = await import('../../lib/supabase')
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ upsert: upsertMock })

    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))

    // Set opening float to 50, actual cash to 165
    fireEvent.change(screen.getByLabelText(/opening float/i), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText(/actual cash/i), { target: { value: '165' } })

    fireEvent.click(screen.getByRole('button', { name: /close day/i }))

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('z_reports')
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          report_date: DATE,
          opening_float: 50,
          actual_cash: 165,
        }),
        expect.objectContaining({ onConflict: 'report_date' })
      )
    })
  })

  it('Close Day invokes send-z-report edge function', async () => {
    const { supabase } = await import('../../lib/supabase')
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'send-z-report',
        expect.objectContaining({ body: expect.objectContaining({ reportDate: DATE }) })
      )
    })
  })

  it('Close Day calls onDayClose after success', async () => {
    const onDayClose = vi.fn()
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={onDayClose} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))
    await waitFor(() => {
      expect(onDayClose).toHaveBeenCalledOnce()
    })
  })

  it('Close Day shows error when upsert fails', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } }),
    })
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))
    await waitFor(() => {
      expect(screen.getByText(/insert failed/i)).toBeInTheDocument()
    })
  })
})
