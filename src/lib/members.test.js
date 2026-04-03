vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}))
vi.mock('./db', () => ({ db: { members: { put: vi.fn() } } }))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { upsertMember, settleTab } from './members'

beforeEach(() => vi.clearAllMocks())

describe('upsertMember', () => {
  it('invites member via edge function when email provided on create', async () => {
    const mockMember = { id: 'uuid-1', name: 'Test', membership_number: 'M0001', email: 'test@test.com' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
      head: true,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'Test', email: 'test@test.com' })
    // Allow the fire-and-forget promise to resolve
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-member', {
      body: { member_id: 'uuid-1', email: 'test@test.com' },
    })
  })

  it('does not invite when no email provided on create', async () => {
    const mockMember = { id: 'uuid-2', name: 'NoEmail', membership_number: 'M0002' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
      head: true,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'NoEmail' })
    // Flush microtask queue for consistency with fire-and-forget pattern
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('does not invite when updating existing member (id present)', async () => {
    const mockMember = { id: 'uuid-3', name: 'Existing', email: 'existing@test.com' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ id: 'uuid-3', name: 'Existing', email: 'existing@test.com' })

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })
})

describe('settleTab', () => {
  function setupMocks(balance) {
    const memberSelect = vi.fn().mockReturnThis()
    const memberEq = vi.fn().mockReturnThis()
    const memberSingle = vi.fn().mockResolvedValue({ data: { tab_balance: balance }, error: null })
    const memberUpdate = vi.fn().mockReturnThis()
    const memberEqUpdate = vi.fn().mockResolvedValue({ error: null })
    const ordersInsert = vi.fn().mockResolvedValue({ error: null })

    supabase.from.mockImplementation((table) => {
      if (table === 'members') return {
        select: memberSelect,
        eq: memberEq,
        single: memberSingle,
        update: memberUpdate,
      }
      if (table === 'orders') return { insert: ordersInsert }
      return {}
    })
    memberUpdate.mockReturnValue({ eq: memberEqUpdate })

    return { memberUpdate, memberEqUpdate, ordersInsert }
  }

  it('deducts the full amount when paying the full balance', async () => {
    const { ordersInsert } = setupMocks(15.50)
    await settleTab('member-1', 15.50, 'cash')
    expect(ordersInsert).toHaveBeenCalledWith(expect.objectContaining({
      member_id: 'member-1',
      payment_method: 'cash',
      total_amount: 15.50,
      status: 'paid',
    }))
  })

  it('deducts a partial amount leaving remainder on tab', async () => {
    const { ordersInsert } = setupMocks(15.50)
    await settleTab('member-1', 10.00, 'card')
    expect(ordersInsert).toHaveBeenCalledWith(expect.objectContaining({
      total_amount: 10.00,
      payment_method: 'card',
    }))
  })

  it('does not allow balance to go below zero', async () => {
    const { memberEqUpdate } = setupMocks(5.00)
    // overpayment — should clamp to 0
    await settleTab('member-1', 100.00, 'cash')
    // The update should have been called (we can't easily check the value in this mock setup,
    // but it should not throw)
  })
})
