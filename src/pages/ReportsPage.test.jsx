import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ReportsPage from './ReportsPage'

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
  default: ({ onConfirm, onCancel }) => (
    <div data-testid="pin-gate">
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
