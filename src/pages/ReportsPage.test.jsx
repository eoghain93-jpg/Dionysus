import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from './ReportsPage'
import { supabase } from '../lib/supabase'
import { logEvent } from '../lib/audit/log'

// The page renders a <Link to="/stocktake">, so it needs router context
const renderPage = () => render(<ReportsPage />, { wrapper: MemoryRouter })

// Mock child report components so they don't make real queries
vi.mock('../components/reports/DailySummary', () => ({
  default: () => <div data-testid="daily-summary-stub" />,
}))
vi.mock('../components/reports/BusiestHours', () => ({
  default: () => <div data-testid="busiest-hours-stub" />,
}))
vi.mock('../components/reports/TopProducts', () => ({
  default: () => <div data-testid="top-products-stub" />,
}))
vi.mock('../components/reports/ZReportModal', () => ({
  default: ({ onClose, onDayClose }) => (
    <div data-testid="z-report-modal">
      <button onClick={onClose}>Close Modal</button>
      <button onClick={onDayClose}>Day Closed</button>
    </div>
  ),
}))

// Mock PinGate — immediately calls onConfirm so we can test the full flow
vi.mock('../components/till/PinGate', () => ({
  default: ({ onConfirm, onCancel, purpose }) => (
    <div data-testid="pin-gate" data-purpose={purpose}>
      <button onClick={onConfirm}>Enter PIN</button>
      <button onClick={onCancel}>Cancel PIN</button>
    </div>
  ),
}))

// Mock supabase for Export CSV
vi.mock('../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
// Staff-name lookup is its own unit; pass the orders straight through
vi.mock('../lib/orders', () => ({ attachStaffNames: vi.fn(async orders => orders) }))

describe('ReportsPage — Z Report button', () => {
  it('renders a Z Report button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /z report/i })).toBeInTheDocument()
  })

  it('clicking Z Report shows the PinGate', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    expect(screen.getByTestId('pin-gate')).toBeInTheDocument()
  })

  it('tells the PinGate what the PIN is for (recorded with the check)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    expect(screen.getByTestId('pin-gate')).toHaveAttribute('data-purpose', 'z_report')
  })

  it('PinGate is not shown initially', () => {
    renderPage()
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
  })
})

describe('ReportsPage — PinGate flow', () => {
  it('entering PIN hides PinGate and shows ZReportModal', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(screen.getByTestId('z-report-modal')).toBeInTheDocument()
  })

  it('cancelling PinGate hides it without showing ZReportModal', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel pin/i }))
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('z-report-modal')).not.toBeInTheDocument()
  })
})

describe('ReportsPage — ZReportModal flow', () => {
  function openModal() {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))
  }

  it('closing the modal hides it', () => {
    openModal()
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }))
    expect(screen.queryByTestId('z-report-modal')).not.toBeInTheDocument()
  })

  it('onDayClose hides the modal', () => {
    openModal()
    fireEvent.click(screen.getByRole('button', { name: /day closed/i }))
    expect(screen.queryByTestId('z-report-modal')).not.toBeInTheDocument()
  })
})

describe('ReportsPage — Export CSV', () => {
  const ORDERS = [
    { id: 'o1', created_at: '2026-03-30T20:00:00Z', total_amount: 7.4, payment_method: 'cash', status: 'paid', till_id: 'till-1', members: null },
    { id: 'o2', created_at: '2026-03-30T20:05:00Z', total_amount: 12, payment_method: 'card', status: 'paid', till_id: 'till-2', members: { name: 'Alice', membership_number: 'M0001' } },
  ]
  let click

  beforeEach(() => {
    vi.clearAllMocks()
    supabase.__reset()
    // jsdom has no object URLs
    URL.createObjectURL = vi.fn(() => 'blob:orders')
    URL.revokeObjectURL = vi.fn()
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    click.mockRestore()
    delete URL.createObjectURL
    delete URL.revokeObjectURL
  })

  it('logs report.exported with the date and how many orders left the till', async () => {
    supabase.__configure({ orders: { data: ORDERS } })
    renderPage()
    const date = screen.getByLabelText(/select report date/i).value
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(logEvent.mock.calls).toEqual([
      ['report.exported', { report: 'daily', date, rows: 2 }, { severity: 1 }],
    ])
  })

  it('logs nothing when there was nothing to export', async () => {
    supabase.__configure({ orders: { data: [] } })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /export csv/i })).not.toBeDisabled())
    expect(click).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs nothing for opening the Z report gate (the PIN check is recorded by the database)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))
    expect(logEvent).not.toHaveBeenCalled()
  })
})
