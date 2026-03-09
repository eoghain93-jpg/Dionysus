import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import MemberList, { isRenewalDueSoon } from '../MemberList'

// Mock the members data layer (not used directly by MemberList, kept for completeness)
vi.mock('../../../lib/members', () => ({
  fetchMembers: vi.fn(),
  upsertMember: vi.fn(),
  settleTab: vi.fn(),
}))

const noop = () => {}

// Helper: date string N days from today
function daysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const baseMember = {
  id: '1',
  name: 'Alice Brennan',
  membership_number: 'M0001',
  membership_tier: 'member',
  tab_balance: 0,
  renewal_date: daysFromNow(90), // well beyond 30 days
  phone: '07700000001',
  email: 'alice@example.com',
}

describe('isRenewalDueSoon', () => {
  it('returns true when renewal is within 30 days', () => {
    expect(isRenewalDueSoon(daysFromNow(10))).toBe(true)
  })

  it('returns true when renewal is today (0 days)', () => {
    expect(isRenewalDueSoon(daysFromNow(0))).toBe(true)
  })

  it('returns true when renewal is exactly 30 days away', () => {
    expect(isRenewalDueSoon(daysFromNow(30))).toBe(true)
  })

  it('returns false when renewal is 31+ days away', () => {
    expect(isRenewalDueSoon(daysFromNow(31))).toBe(false)
  })

  it('returns false when renewal_date is null', () => {
    expect(isRenewalDueSoon(null)).toBe(false)
  })
})

describe('MemberList', () => {
  it('renders member name and membership number', () => {
    render(<MemberList members={[baseMember]} onSelect={noop} onEdit={noop} />)
    expect(screen.getByText('Alice Brennan')).toBeInTheDocument()
    expect(screen.getByText('M0001')).toBeInTheDocument()
  })

  it('shows tab balance formatted with £ when balance > 0', () => {
    const member = { ...baseMember, tab_balance: 12.5 }
    render(<MemberList members={[member]} onSelect={noop} onEdit={noop} />)
    expect(screen.getByText('Tab: £12.50')).toBeInTheDocument()
  })

  it('hides tab balance when balance is 0', () => {
    const member = { ...baseMember, tab_balance: 0 }
    render(<MemberList members={[member]} onSelect={noop} onEdit={noop} />)
    expect(screen.queryByText(/Tab:/)).not.toBeInTheDocument()
  })

  it('shows renewal alert icon and "Renewal due" text when renewal is within 30 days', () => {
    const member = { ...baseMember, renewal_date: daysFromNow(15) }
    render(<MemberList members={[member]} onSelect={noop} onEdit={noop} />)
    // Text label must be present (not colour alone)
    expect(screen.getByText('Renewal due')).toBeInTheDocument()
    // The wrapper has an accessible label
    expect(screen.getByLabelText('Renewal due soon')).toBeInTheDocument()
  })

  it('does NOT show renewal alert when renewal is more than 30 days away', () => {
    const member = { ...baseMember, renewal_date: daysFromNow(60) }
    render(<MemberList members={[member]} onSelect={noop} onEdit={noop} />)
    expect(screen.queryByText('Renewal due')).not.toBeInTheDocument()
  })

  it('calls onSelect with the member when row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MemberList members={[baseMember]} onSelect={onSelect} onEdit={noop} />)
    await user.click(screen.getByRole('button', { name: /View profile for Alice Brennan/i }))
    expect(onSelect).toHaveBeenCalledWith(baseMember)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onEdit with the member when Edit button is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<MemberList members={[baseMember]} onSelect={noop} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: /Edit Alice Brennan/i }))
    expect(onEdit).toHaveBeenCalledWith(baseMember)
  })

  it('shows "No members found." when members array is empty', () => {
    render(<MemberList members={[]} onSelect={noop} onEdit={noop} />)
    expect(screen.getByText('No members found.')).toBeInTheDocument()
  })

  it('renders multiple members', () => {
    const members = [
      baseMember,
      { ...baseMember, id: '2', name: 'Bob Murphy', membership_number: 'M0002' },
    ]
    render(<MemberList members={members} onSelect={noop} onEdit={noop} />)
    expect(screen.getByText('Alice Brennan')).toBeInTheDocument()
    expect(screen.getByText('Bob Murphy')).toBeInTheDocument()
  })
})
