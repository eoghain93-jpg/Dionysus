import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MemberLookup from './MemberLookup'
import { useTillStore } from '../../stores/tillStore'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

vi.mock('../../lib/members', () => ({
  findMemberByNumber: vi.fn().mockResolvedValue(null),
}))

vi.mock('html5-qrcode', () => ({
  Html5QrcodeScanner: vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

beforeEach(() => useTillStore.setState({ orderItems: [], activeMember: null }))

describe('MemberLookup', () => {
  it('renders search input when no member active', () => {
    render(<MemberLookup />)
    expect(screen.getByPlaceholderText(/member number/i)).toBeInTheDocument()
  })

  it('renders nothing when a member is active', () => {
    useTillStore.setState({ activeMember: { id: 'm1', name: 'John', membership_number: 'M0001' } })
    const { container } = render(<MemberLookup />)
    expect(container.firstChild).toBeNull()
  })
})
