import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from './NavBar'

describe('NavBar', () => {
  it('renders all navigation links', () => {
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    expect(screen.getAllByText('Till').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0)
  })
})
