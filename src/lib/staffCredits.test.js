import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./till', () => ({ getTillId: () => 'till-1' }))

import { supabase } from './supabase'
import { fetchStaffMembers, fetchBankedCredits, redeemCredit } from './staffCredits'

beforeEach(() => {
  supabase.__reset()
})

describe('fetchStaffMembers', () => {
  it('returns active staff ordered by name', async () => {
    const staff = [{ id: 's1', name: 'Dave' }, { id: 's2', name: 'Eve' }]
    supabase.__configure({ members: { data: staff } })

    const result = await fetchStaffMembers()

    expect(result).toEqual(staff)
    expect(supabase.__chain('members').eq).toHaveBeenCalledWith('membership_tier', 'staff')
    expect(supabase.__chain('members').eq).toHaveBeenCalledWith('active', true)
  })

  it('throws on error', async () => {
    supabase.__configure({ members: { error: new Error('boom') } })
    await expect(fetchStaffMembers()).rejects.toThrow('boom')
  })
})

describe('fetchBankedCredits', () => {
  it('returns only banked credits for the staff member, oldest first', async () => {
    const credits = [{ id: 'c1', amount: 5.5, products: { name: 'Guinness' } }]
    supabase.__configure({ staff_drink_credits: { data: credits } })

    const result = await fetchBankedCredits('s1')

    expect(result).toEqual(credits)
    const chain = supabase.__chain('staff_drink_credits')
    expect(chain.eq).toHaveBeenCalledWith('staff_member_id', 's1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'banked')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })
})

describe('redeemCredit', () => {
  it('calls the redeem RPC with the credit, poured product, till and pourer', async () => {
    supabase.rpc.mockResolvedValue({ data: 'c1', error: null })

    await redeemCredit('c1', 'prod-9', 'staff-1')

    expect(supabase.rpc).toHaveBeenCalledWith('redeem_staff_drink_credit', {
      p_credit_id: 'c1',
      p_product_id: 'prod-9',
      p_till_id: 'till-1',
      p_redeemed_by: 'staff-1',
    })
  })

  it('sends a null pourer when none is known', async () => {
    supabase.rpc.mockResolvedValue({ data: 'c1', error: null })
    await redeemCredit('c1', 'prod-9')
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_staff_drink_credit',
      expect.objectContaining({ p_redeemed_by: null }))
  })

  it('throws when the RPC reports an error (e.g. already redeemed)', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('already redeemed') })
    await expect(redeemCredit('c1', 'prod-9', 'staff-1')).rejects.toThrow('already redeemed')
  })
})
