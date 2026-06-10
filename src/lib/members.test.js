import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({ db: { members: { put: vi.fn() } } }))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { upsertMember, settleTab } from './members'

beforeEach(() => supabase.__reset())

describe('upsertMember', () => {
  it('invites member via edge function when email provided on create', async () => {
    const mockMember = { id: 'uuid-1', name: 'Test', membership_number: 'M0001', email: 'test@test.com' }

    supabase.__configure({
      // first call: like-query for existing M#### numbers, second call: insert
      members: [{ data: [] }, { data: mockMember }],
    })

    await upsertMember({ name: 'Test', email: 'test@test.com' })
    // Allow the fire-and-forget promise to resolve
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-member', {
      body: { member_id: 'uuid-1', email: 'test@test.com' },
    })
  })

  it('generates the next membership number from the max existing M number', async () => {
    const mockMember = { id: 'uuid-9', name: 'Next', membership_number: 'M0042' }

    supabase.__configure({
      members: [
        { data: [{ membership_number: 'M0041' }, { membership_number: 'M0007' }] },
        { data: mockMember },
      ],
    })

    await upsertMember({ name: 'Next' })

    expect(supabase.__chain('members', 1).insert).toHaveBeenCalledWith(
      expect.objectContaining({ membership_number: 'M0042' })
    )
  })

  it('does not invite when no email provided on create', async () => {
    const mockMember = { id: 'uuid-2', name: 'NoEmail', membership_number: 'M0002' }

    supabase.__configure({
      members: [{ data: [] }, { data: mockMember }],
    })

    await upsertMember({ name: 'NoEmail' })
    // Flush microtask queue for consistency with fire-and-forget pattern
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('does not invite when updating existing member (id present)', async () => {
    const mockMember = { id: 'uuid-3', name: 'Existing', email: 'existing@test.com' }

    supabase.__configure({ members: { data: mockMember } })

    await upsertMember({ id: 'uuid-3', name: 'Existing', email: 'existing@test.com' })

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })
})

describe('settleTab', () => {
  // The balance maths happens server-side in the adjust_tab_balance RPC
  // (atomic UPDATE, clamped at zero); the mock returns the post-update
  // balance the server would compute.
  function setupMocks(newBalanceFromRpc) {
    supabase.rpc.mockResolvedValue({ data: newBalanceFromRpc, error: null })
    supabase.__configure({
      members: { error: null }, // last_settled_at stamp update
      orders: { error: null },  // settlement order insert
    })
  }

  const ordersInsert = () => supabase.__chain('orders').insert

  it('settles via the atomic RPC and records a settlement order', async () => {
    setupMocks(0)
    await settleTab('member-1', 15.50, 'cash')
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -15.50,
    })
    expect(ordersInsert()).toHaveBeenCalledWith(expect.objectContaining({
      member_id: 'member-1',
      payment_method: 'cash',
      total_amount: 15.50,
      status: 'paid',
    }))
  })

  it('deducts a partial amount leaving remainder on tab', async () => {
    setupMocks(5.50)
    await settleTab('member-1', 10.00, 'card')
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -10.00,
    })
    expect(ordersInsert()).toHaveBeenCalledWith(expect.objectContaining({
      total_amount: 10.00,
      payment_method: 'card',
    }))
  })

  it('stamps last_settled_at when the balance hits zero (full settlement)', async () => {
    setupMocks(0)
    await settleTab('member-1', 15.50, 'cash')
    const updatePayload = supabase.__chain('members').update.mock.calls[0][0]
    expect(updatePayload.last_settled_at).toEqual(expect.any(String))
    // ISO 8601 timestamp shape
    expect(updatePayload.last_settled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('does NOT stamp last_settled_at on a partial settlement', async () => {
    setupMocks(5.50)
    await settleTab('member-1', 10.00, 'card')
    expect(supabase.__chain('members')).toBeUndefined() // no members update at all
  })

  it('stamps last_settled_at on overpayment (server clamps the balance to zero)', async () => {
    setupMocks(0) // RPC returns 0 even though delta exceeded the balance
    await settleTab('member-1', 100.00, 'cash')
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -100.00,
    })
    const updatePayload = supabase.__chain('members').update.mock.calls[0][0]
    expect(updatePayload.last_settled_at).toEqual(expect.any(String))
  })

  it('throws when the RPC fails (Supabase returns errors, not throws)', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'member not found' } })
    await expect(settleTab('member-1', 10.00, 'cash')).rejects.toThrow('member not found')
  })

  it('throws when the settlement order insert fails', async () => {
    supabase.rpc.mockResolvedValue({ data: 5.50, error: null })
    supabase.__configure({ orders: { error: { message: 'insert failed' } } })
    await expect(settleTab('member-1', 10.00, 'cash')).rejects.toThrow('insert failed')
  })
})
