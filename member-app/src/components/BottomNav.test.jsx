import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}))

describe('BottomNav', () => {
  it('renders all four navigation tabs', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getByText('My Card')).toBeInTheDocument()
    expect(screen.getByText('My Tab')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
  })
})
