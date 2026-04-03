import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import NavBar from './NavBar'

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
})
