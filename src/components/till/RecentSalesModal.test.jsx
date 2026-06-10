import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecentSalesModal from './RecentSalesModal'
import { useSessionStore } from '../../stores/sessionStore'

const { mockFetchTodaysOrders, mockCorrect, mockAddToast } = vi.hoisted(() => ({
  mockFetchTodaysOrders: vi.fn(),
  mockCorrect: vi.fn(),
  mockAddToast: vi.fn(),
}))

vi.mock('../../lib/orders', () => ({
  fetchTodaysOrders: mockFetchTodaysOrders,
  correctOrderPaymentMethod: mockCorrect,
}))

vi.mock('../../hooks/useToast', () => ({
  useToastStore: { getState: () => ({ addToast: mockAddToast }) },
}))

// PinGate stub — confirm/cancel buttons so the gate flow is testable
vi.mock('./PinGate', () => ({
  default: ({ onConfirm, onCancel, label }) => (
    <div data-testid="pin-gate">
      <span>{label}</span>
      <button onClick={onConfirm}>Enter PIN</button>
      <button onClick={onCancel}>Cancel PIN</button>
    </div>
  ),
}))

const TODAY = new Date().toISOString().split('T')[0]
const ORDERS = [
  { id: 'o-card', created_at: `${TODAY}T20:15:00`, total_amount: 12.30, payment_method: 'card', status: 'paid' },
  { id: 'o-cash', created_at: `${TODAY}T19:40:00`, total_amount: 5.50, payment_method: 'cash', status: 'paid' },
  { id: 'o-tab',  created_at: `${TODAY}T19:05:00`, total_amount: 9.00, payment_method: 'tab',  status: 'paid' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Dave' } })
  mockFetchTodaysOrders.mockResolvedValue(ORDERS)
  mockCorrect.mockResolvedValue('card')
})

describe('RecentSalesModal', () => {
  it("lists today's sales with totals and payment methods", async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    expect(await screen.findByText('£12.30')).toBeInTheDocument()
    expect(screen.getByText('£5.50')).toBeInTheDocument()
    expect(screen.getByText('Tab')).toBeInTheDocument()
  })

  it('offers the opposite method per sale: card→cash, cash→card', async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    await screen.findByText('£12.30')
    expect(screen.getByRole('button', { name: /switch 20:15 sale to cash/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch 19:40 sale to card/i })).toBeInTheDocument()
  })

  it('tab sales are not correctable from the till', async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    await screen.findByText('£9.00')
    expect(screen.getByText(/ask manager/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switch 19:05/i })).not.toBeInTheDocument()
  })

  it('requires a PIN before applying a fix', async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /switch 20:15 sale to cash/i }))
    expect(screen.getByTestId('pin-gate')).toHaveTextContent('Fix Payment')
    expect(mockCorrect).not.toHaveBeenCalled()
  })

  it('applies the correction after PIN confirm and reloads the list', async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /switch 20:15 sale to cash/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))

    await waitFor(() => {
      expect(mockCorrect).toHaveBeenCalledWith('o-card', 'cash', 'staff-1')
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/switched to cash/i), 'success')
    })
    expect(mockFetchTodaysOrders).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('cancelling the PIN gate applies nothing', async () => {
    render(<RecentSalesModal onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /switch 20:15 sale to cash/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel pin/i }))
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(mockCorrect).not.toHaveBeenCalled()
  })

  it('surfaces the server guard message when the RPC refuses', async () => {
    mockCorrect.mockRejectedValue(new Error('today has already been closed — ask the manager'))
    render(<RecentSalesModal onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /switch 20:15 sale to cash/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter pin/i }))

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringMatching(/already been closed/i), 'error')
    })
  })

  it('shows an empty state when there are no sales today', async () => {
    mockFetchTodaysOrders.mockResolvedValue([])
    render(<RecentSalesModal onClose={vi.fn()} />)
    expect(await screen.findByText(/no sales yet today/i)).toBeInTheDocument()
  })
})
