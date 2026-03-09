import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MemberLookup from './MemberLookup'
import { useTillStore } from '../../stores/tillStore'

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
