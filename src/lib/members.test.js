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
  function setupMocks(balance) {
    supabase.__configure({
      // first call: select tab_balance, second call: update
      members: [{ data: { tab_balance: balance } }, { error: null }],
      orders: { error: null },
    })
  }

  const memberUpdatePayload = () => supabase.__chain('members', 1).update.mock.calls[0][0]
  const ordersInsert = () => supabase.__chain('orders').insert

  it('deducts the full amount when paying the full balance', async () => {
    setupMocks(15.50)
    await settleTab('member-1', 15.50, 'cash')
    expect(ordersInsert()).toHaveBeenCalledWith(expect.objectContaining({
      member_id: 'member-1',
      payment_method: 'cash',
      total_amount: 15.50,
      status: 'paid',
    }))
  })

  it('deducts a partial amount leaving remainder on tab', async () => {
    setupMocks(15.50)
    await settleTab('member-1', 10.00, 'card')
    expect(ordersInsert()).toHaveBeenCalledWith(expect.objectContaining({
      total_amount: 10.00,
      payment_method: 'card',
    }))
  })

  it('does not allow balance to go below zero', async () => {
    setupMocks(5.00)
    // overpayment — should clamp to 0
    await settleTab('member-1', 100.00, 'cash')
    expect(memberUpdatePayload().tab_balance).toBe(0)
  })

  it('stamps last_settled_at when the balance hits zero (full settlement)', async () => {
    setupMocks(15.50)
    await settleTab('member-1', 15.50, 'cash')
    const updatePayload = memberUpdatePayload()
    expect(updatePayload.tab_balance).toBe(0)
    expect(updatePayload.last_settled_at).toEqual(expect.any(String))
    // ISO 8601 timestamp shape
    expect(updatePayload.last_settled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('does NOT stamp last_settled_at on a partial settlement', async () => {
    setupMocks(15.50)
    await settleTab('member-1', 10.00, 'card')
    const updatePayload = memberUpdatePayload()
    expect(updatePayload.tab_balance).toBe(5.50)
    expect(updatePayload.last_settled_at).toBeUndefined()
  })

  it('stamps last_settled_at on overpayment (clamped to zero)', async () => {
    setupMocks(5.00)
    await settleTab('member-1', 100.00, 'cash')
    const updatePayload = memberUpdatePayload()
    expect(updatePayload.tab_balance).toBe(0)
    expect(updatePayload.last_settled_at).toEqual(expect.any(String))
  })
})
