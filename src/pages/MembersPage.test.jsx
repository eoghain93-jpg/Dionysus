import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MembersPage from './MembersPage'
import { fetchMembers } from '../lib/members'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/members', () => ({ fetchMembers: vi.fn() }))
vi.mock('../components/members/MemberProfile', () => ({
  default: ({ member, onClose }) => (
    <div data-testid="member-profile">
      <span>Profile of {member.name}</span>
      <button onClick={onClose}>Close profile</button>
    </div>
  ),
}))
vi.mock('../components/members/MemberFormModal', () => ({
  default: () => <div data-testid="member-form" />,
}))

const MEMBERS = [
  { id: 'm1', name: 'Alice Brennan', membership_number: 'M0001', membership_tier: 'member', tab_balance: 0, phone: '07700 900123', email: 'alice@example.com', pin_hash: 'SECRET' },
  { id: 'm2', name: 'Bob Murphy', membership_number: 'M0002', membership_tier: 'staff', tab_balance: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchMembers.mockResolvedValue(MEMBERS)
})

describe('MembersPage — audit events', () => {
  it('logs member.profile_viewed when a profile is opened', async () => {
    render(<MembersPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'View profile for Alice Brennan' }))
    expect(screen.getByTestId('member-profile')).toHaveTextContent('Profile of Alice Brennan')
    expect(logEvent.mock.calls).toEqual([
      ['member.profile_viewed', { member_id: 'm1' }],
    ])
  })

  it('logs each profile opened, with the id only — never the member record', async () => {
    render(<MembersPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'View profile for Alice Brennan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'View profile for Bob Murphy' }))
    expect(logEvent.mock.calls.map(c => c[1])).toEqual([{ member_id: 'm1' }, { member_id: 'm2' }])
    const logged = JSON.stringify(logEvent.mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('07700')
    expect(logged).not.toContain('alice@example.com')
  })

  it('logs nothing for listing, searching or opening the edit form', async () => {
    render(<MembersPage />)
    await screen.findByText('Alice Brennan')
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'bob' } })
    expect(screen.queryByText('Alice Brennan')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByTestId('member-form')).toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
  })
})
