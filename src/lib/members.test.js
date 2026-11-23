import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({ db: { members: { put: vi.fn(), bulkPut: vi.fn() } } }))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { db } from './db'
import { upsertMember, settleTab, fetchMembers, searchMembersByName } from './members'

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
  // Balance maths, the last_settled_at stamp and the settlement order insert
  // all happen server-side in the settle_tab RPC (one transaction).
  it('settles via the atomic settle_tab RPC with the till id', async () => {
    supabase.rpc.mockResolvedValue({ data: 0, error: null })
    await settleTab('member-1', 15.50, 'cash', 'staff-1')
    expect(supabase.rpc).toHaveBeenCalledWith('settle_tab', {
      p_member_id: 'member-1',
      p_amount: 15.50,
      p_payment_method: 'cash',
      p_till_id: expect.any(String),
      p_staff_id: 'staff-1',
    })
  })

  // The new bundle can reach a till before the database update has landed.
  it('retries the old 4-argument call when the database has no p_staff_id yet', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.settle_tab(...) in the schema cache' } })
      .mockResolvedValueOnce({ data: 4.5, error: null })

    await expect(settleTab('member-1', 10, 'card', 'staff-1')).resolves.toBe(4.5)

    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    expect(supabase.rpc.mock.calls[1]).toEqual(['settle_tab', {
      p_member_id: 'member-1', p_amount: 10, p_payment_method: 'card', p_till_id: expect.any(String),
    }])
  })

  it('NEVER retries after any other failure (the first call may have taken the payment)', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(settleTab('member-1', 10, 'card', 'staff-1')).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)

    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    await expect(settleTab('member-1', 10, 'card', 'staff-1')).rejects.toBeTruthy()
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('makes one call when the database is up to date', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 0, error: null })
    await settleTab('member-1', 10, 'card', 'staff-1')
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('sends a null staff id when nobody is signed in', async () => {
    supabase.rpc.mockResolvedValue({ data: 0, error: null })
    await settleTab('member-1', 15.50, 'cash')
    expect(supabase.rpc).toHaveBeenCalledWith('settle_tab', expect.objectContaining({ p_staff_id: null }))
  })

  it('makes no client-side table writes (no split-brain settle)', async () => {
    supabase.rpc.mockResolvedValue({ data: 5.50, error: null })
    await settleTab('member-1', 10.00, 'card')
    expect(supabase.__chain('members')).toBeUndefined()
    expect(supabase.__chain('orders')).toBeUndefined()
  })

  it('returns the new balance from the server', async () => {
    supabase.rpc.mockResolvedValue({ data: '5.50', error: null })
    await expect(settleTab('member-1', 10.00, 'card')).resolves.toBe(5.5)
  })

  it('throws when the RPC fails (Supabase returns errors, not throws)', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'member not found' } })
    await expect(settleTab('member-1', 10.00, 'cash')).rejects.toThrow('member not found')
  })
})

describe('staff PIN hashes never reach the till\'s local cache', () => {
  const sam = { id: 's1', name: 'Sam Staff', membership_tier: 'staff', pin_hash: '$2b$10$secretsecretsecret', active: true }
  const mo = { id: 'm1', name: 'Mo Member', membership_tier: 'member', pin_hash: null, active: true }

  beforeEach(() => { db.members.put.mockClear(); db.members.bulkPut.mockClear() })

  it('fetchMembers drops pin_hash before caching and returning, keeping only whether a PIN exists', async () => {
    supabase.__configure({ members: { data: [sam, mo] } })

    const result = await fetchMembers()

    expect(JSON.stringify(result)).not.toContain('secretsecret')
    expect(JSON.stringify(db.members.bulkPut.mock.calls)).not.toContain('secretsecret')
    expect(result.map(m => m.has_pin)).toEqual([true, false])
    expect(result[0]).not.toHaveProperty('pin_hash')
  })

  it('searchMembersByName does the same', async () => {
    supabase.__configure({ members: { data: [sam] } })
    const result = await searchMembersByName('sam')
    expect(JSON.stringify(result)).not.toContain('secretsecret')
    expect(JSON.stringify(db.members.bulkPut.mock.calls)).not.toContain('secretsecret')
  })

  it('upsertMember does the same for the row it gets back', async () => {
    supabase.__configure({ members: { data: sam } })
    const result = await upsertMember({ id: 's1', name: 'Sam Staff' })
    expect(JSON.stringify(result)).not.toContain('secretsecret')
    expect(JSON.stringify(db.members.put.mock.calls)).not.toContain('secretsecret')
  })
})
