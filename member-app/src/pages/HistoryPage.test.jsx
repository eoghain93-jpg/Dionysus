import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HistoryPage from './HistoryPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { id: 'uuid-1' },
  }),
}))

const mockOrdersData = [{ id: 'o1', total_amount: 8.50, created_at: '2026-03-19T20:00:00Z', payment_method: 'tab' }]
const mockPaymentsData = [{ id: 'p1', amount: 20.00, created_at: '2026-03-18T10:00:00Z' }]

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(
        table === 'orders'
          ? { data: mockOrdersData, error: null }
          : { data: mockPaymentsData, error: null }
      ),
    })),
  },
}))

describe('HistoryPage', () => {
  it('renders tab purchases and payments', async () => {
    render(<HistoryPage />)
    await waitFor(() => {
      expect(screen.getByText('−£8.50')).toBeInTheDocument()
      expect(screen.getByText('+£20.00')).toBeInTheDocument()
    })
  })
})
