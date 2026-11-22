import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import NavBar from './NavBar'

vi.mock('../lib/tabs', () => ({
  fetchTabAges: vi.fn().mockResolvedValue({
    m1: { days: 20, overdue: true },
    m2: { days: 30, overdue: true },
    m3: { days: 2, overdue: false },
  }),
}))

vi.mock('./till/SwitchUserModal', () => ({
  default: () => null,
}))

describe('NavBar', () => {
  it('renders all navigation links', () => {
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    expect(screen.getAllByText('Till').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0)
  })

  it('badges the Tabs link with the number of overdue tabs', async () => {
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getAllByLabelText('2 overdue tabs').length).toBeGreaterThan(0)
    })
  })
})
