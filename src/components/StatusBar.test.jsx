import { render, screen } from '@testing-library/react'
import StatusBar from './StatusBar'
import { useSyncStore } from '../stores/syncStore'

describe('StatusBar', () => {
  it('shows Online when connected', () => {
    useSyncStore.setState({ isOnline: true, pendingCount: 0 })
    render(<StatusBar />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('shows Offline when disconnected', () => {
    useSyncStore.setState({ isOnline: false, pendingCount: 0 })
    render(<StatusBar />)
    expect(screen.getByText(/Offline/)).toBeInTheDocument()
  })

  it('shows pending count when offline with transactions', () => {
    useSyncStore.setState({ isOnline: false, pendingCount: 3 })
    render(<StatusBar />)
    expect(screen.getByText(/3 transactions pending/)).toBeInTheDocument()
  })
})
