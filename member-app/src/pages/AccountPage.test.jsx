import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccountPage from './AccountPage'

const mockSignOut = vi.fn()
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { name: 'Jane Smith', email: 'jane@test.com', membership_number: 'M0042', membership_tier: 'member' },
    signOut: mockSignOut,
  }),
}))

describe('AccountPage', () => {
  it('shows member details', () => {
    render(<AccountPage />)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('jane@test.com')).toBeInTheDocument()
    expect(screen.getByText('M0042')).toBeInTheDocument()
  })

  it('has a sign out button', () => {
    render(<AccountPage />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })
})
