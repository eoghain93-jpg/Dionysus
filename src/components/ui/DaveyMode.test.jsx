import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import DaveyMode from './DaveyMode'
import NavBar from '../NavBar'
import { useSessionStore } from '../../stores/sessionStore'

vi.mock('../till/SwitchUserModal', () => ({
  default: () => null,
}))

describe('DaveyMode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the takeover and closes itself after a few seconds', () => {
    const onClose = vi.fn()
    render(<DaveyMode onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: /davey mode/i })).toBeInTheDocument()
    expect(screen.getByText(/howay the lads/i)).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(5000) })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on tap and on Escape', () => {
    const onClose = vi.fn()
    render(<DaveyMode onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('NavBar Davey button', () => {
  afterEach(() => useSessionStore.setState({ activeStaff: null }))

  it('is hidden when no staff member is logged in', () => {
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /davey mode/i })).not.toBeInTheDocument()
  })

  it('plays Davey mode for logged-in staff', () => {
    useSessionStore.setState({ activeStaff: { id: 's1', name: 'Davey' } })
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /davey mode/i }))
    expect(screen.getByText(/howay the lads/i)).toBeInTheDocument()
  })
})
