// src/pages/TabsPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TabsPage from './TabsPage'

vi.mock('../lib/tabs', () => ({
  fetchOpenTabs: vi.fn(),
  fetchTabOrders: vi.fn(),
}))

vi.mock('../components/members/SettleTabModal', () => ({
  default: ({ member, onClose, onSettled }) => (
    <div role="dialog">
      <span>Settle {member.name}</span>
      <button onClick={onSettled}>Confirm Settle</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}))

import { fetchOpenTabs, fetchTabOrders } from '../lib/tabs'

const mockTabs = [
  { id: 'm1', name: 'Alice', tab_balance: 15.50, membership_number: 'M0001' },
  { id: 'm2', name: 'Bob', tab_balance: 8.00, membership_number: 'M0002' },
]

const mockOrders = [
  {
    id: 'o1',
    created_at: '2026-03-30T20:00:00Z',
    total_amount: 15.50,
    order_items: [
      { id: 'oi1', quantity: 2, unit_price: 5.50, products: { name: 'Guinness' } },
      { id: 'oi2', quantity: 1, unit_price: 4.50, products: { name: 'Coke' } },
    ],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchOpenTabs.mockResolvedValue(mockTabs)
  fetchTabOrders.mockResolvedValue(mockOrders)
})

describe('TabsPage', () => {
  it('renders the page heading', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /tabs/i })).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    fetchOpenTabs.mockReturnValue(new Promise(() => {}))
    render(<TabsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('lists all members with open tabs', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('shows outstanding balance for each member', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('£15.50')).toBeInTheDocument()
      expect(screen.getByText('£8.00')).toBeInTheDocument()
    })
  })

  it('shows total outstanding balance', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('£23.50')).toBeInTheDocument()
    })
  })

  it('shows empty state when no open tabs', async () => {
    fetchOpenTabs.mockResolvedValue([])
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText(/no open tabs/i)).toBeInTheDocument()
    })
  })

  it('expands a row to show orders when clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(fetchTabOrders).toHaveBeenCalledWith('m1')
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('Coke')).toBeInTheDocument()
    })
  })

  it('shows a Settle button for each member', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      const settleButtons = screen.getAllByRole('button', { name: /settle/i })
      expect(settleButtons).toHaveLength(2)
    })
  })

  it('opens SettleTabModal when Settle is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Settle Alice')).toBeInTheDocument()
  })

  it('removes member from list after tab is settled', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    fireEvent.click(screen.getByText('Confirm Settle'))
    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('closes modal without removing member when Cancel is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows an error message when fetchOpenTabs rejects', async () => {
    fetchOpenTabs.mockRejectedValue(new Error('Network error'))
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load tabs/i)).toBeInTheDocument()
      expect(screen.queryByText(/no open tabs/i)).not.toBeInTheDocument()
    })
  })

  it('shows an error message when fetchTabOrders rejects inside an expanded row', async () => {
    fetchTabOrders.mockRejectedValue(new Error('Network error'))
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(screen.getByText(/failed to load orders/i)).toBeInTheDocument()
      expect(screen.queryByText(/no tab orders found/i)).not.toBeInTheDocument()
    })
  })
})
