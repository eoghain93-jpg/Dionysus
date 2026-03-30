import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ReportsPage from './ReportsPage'

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

// Mock PinGate — immediately calls onSuccess so we can test the full flow
vi.mock('../components/till/PinGate', () => ({
  default: ({ onSuccess, onCancel }) => (
    <div data-testid="pin-gate">
      <button onClick={onSuccess}>Enter PIN</button>
      <button onClick={onCancel}>Cancel PIN</button>
    </div>
  ),
}))

// Mock supabase for Export CSV
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}))

describe('ReportsPage — Z Report button', () => {
  it('renders a Z Report button', () => {
    render(<ReportsPage />)
    expect(screen.getByRole('button', { name: /z report/i })).toBeInTheDocument()
  })

  it('clicking Z Report shows the PinGate', () => {
    render(<ReportsPage />)
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    expect(screen.getByTestId('pin-gate')).toBeInTheDocument()
  })

  it('PinGate is not shown initially', () => {
    render(<ReportsPage />)
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
  })
})

describe('ReportsPage — PinGate flow', () => {
  it('entering PIN hides PinGate and shows ZReportModal', () => {
    render(<ReportsPage />)
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(screen.getByTestId('z-report-modal')).toBeInTheDocument()
  })

  it('cancelling PinGate hides it without showing ZReportModal', () => {
    render(<ReportsPage />)
    fireEvent.click(screen.getByRole('button', { name: /z report/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel pin/i }))
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('z-report-modal')).not.toBeInTheDocument()
  })
})

describe('ReportsPage — ZReportModal flow', () => {
  function openModal() {
    render(<ReportsPage />)
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
