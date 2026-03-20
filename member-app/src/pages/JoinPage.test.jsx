import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import JoinPage from './JoinPage'

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

describe('JoinPage', () => {
  it('renders the join form', () => {
    render(<MemoryRouter initialEntries={['/join']}><JoinPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /join for £50/i })).toBeInTheDocument()
  })

  it('shows all three form fields', () => {
    render(<MemoryRouter initialEntries={['/join']}><JoinPage /></MemoryRouter>)
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
  })

  it('shows success message on ?status=success', () => {
    render(<MemoryRouter initialEntries={['/join?status=success']}><JoinPage /></MemoryRouter>)
    expect(screen.getByText(/payment received/i)).toBeInTheDocument()
  })

  it('shows cancelled banner on ?status=cancelled', () => {
    render(<MemoryRouter initialEntries={['/join?status=cancelled']}><JoinPage /></MemoryRouter>)
    expect(screen.getByText(/payment cancelled/i)).toBeInTheDocument()
    // Form should still be visible
    expect(screen.getByRole('button', { name: /join for £50/i })).toBeInTheDocument()
  })
})
