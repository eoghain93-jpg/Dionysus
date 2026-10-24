import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MemberProfile from './MemberProfile'

// ── Mocks ──────────────────────────────────────────────────────────────────────
const { mockAdjustTabBalance } = vi.hoisted(() => ({
  mockAdjustTabBalance: vi.fn(),
}))

vi.mock('../../lib/tabs', () => ({
  adjustTabBalance: mockAdjustTabBalance,
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({ activeStaff: { id: 'staff-1' } }),
}))

// Spend history fetch — resolve with no orders.
vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [] }),
  }
  return { supabase: { from: () => chain } }
})

const EMPTY_TAB_MEMBER = { id: 'mem-1', name: 'Eoghain', membership_number: '42', tab_balance: '0.00' }

function renderProfile(member = EMPTY_TAB_MEMBER, props = {}) {
  const onSettleTab = vi.fn()
  render(
    <MemberProfile
      member={member}
      onClose={vi.fn()}
      onEdit={vi.fn()}
      onSettleTab={onSettleTab}
      {...props}
    />
  )
  return { onSettleTab }
}

describe('MemberProfile — adjust tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdjustTabBalance.mockResolvedValue(undefined)
  })

  it('shows Adjust Tab even when the member has no open tab', () => {
    renderProfile()
    expect(screen.queryByRole('button', { name: /settle tab/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /adjust tab/i })).toBeInTheDocument()
  })

  it('defaults to Add on an empty tab and adds the amount', async () => {
    const { onSettleTab } = renderProfile()
    fireEvent.click(screen.getByRole('button', { name: /adjust tab/i }))

    expect(screen.getByRole('button', { name: /add \(\+\)/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '27.35' } })
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Bar tab carried over' } })
    fireEvent.submit(screen.getByLabelText(/amount/i).closest('form'))

    await waitFor(() => expect(onSettleTab).toHaveBeenCalled())
    expect(mockAdjustTabBalance).toHaveBeenCalledWith('mem-1', 27.35, 'Bar tab carried over', 'staff-1')
  })

  it('still defaults to Reduce when the member owes something', () => {
    renderProfile({ ...EMPTY_TAB_MEMBER, tab_balance: '12.50' })
    fireEvent.click(screen.getByRole('button', { name: /adjust tab/i }))
    expect(screen.getByRole('button', { name: /reduce/i })).toHaveAttribute('aria-pressed', 'true')
  })
})
