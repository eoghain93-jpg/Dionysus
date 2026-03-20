import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyTabPage from './MyTabPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { id: 'uuid-1', name: 'Jane Smith', tab_balance: 12.50 },
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: { url: 'https://stripe.com/checkout/mock' },
        error: null,
      }),
    },
  },
}))

describe('MyTabPage', () => {
  it('displays current tab balance', () => {
    render(<MemoryRouter><MyTabPage /></MemoryRouter>)
    expect(screen.getByText('£12.50')).toBeInTheDocument()
  })

  it('shows pay button when balance is positive', () => {
    render(<MemoryRouter><MyTabPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /pay/i })).toBeInTheDocument()
  })
})
