// src/lib/tabs.test.js
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
import { supabase } from './supabase'
import { fetchOpenTabs, fetchTabOrders, adjustTabBalance, removeOrderFromTab } from './tabs'

beforeEach(() => vi.clearAllMocks())

describe('fetchOpenTabs', () => {
  it('returns members with tab_balance > 0 ordered by balance desc', async () => {
    const members = [
      { id: 'm1', name: 'Alice', tab_balance: 15.50, membership_number: 'M0001' },
      { id: 'm2', name: 'Bob', tab_balance: 8.00, membership_number: 'M0002' },
    ]
    const chain = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: members, error: null })),
    }
    supabase.from.mockReturnValue(chain)

    const result = await fetchOpenTabs()
    expect(supabase.from).toHaveBeenCalledWith('members')
    expect(chain.select).toHaveBeenCalledWith('id, name, tab_balance, membership_number')
    expect(chain.gt).toHaveBeenCalledWith('tab_balance', 0)
    expect(chain.order).toHaveBeenCalledWith('tab_balance', { ascending: false })
    expect(result).toEqual(members)
  })

  it('returns empty array when no open tabs', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
    }
    supabase.from.mockReturnValue(chain)
    expect(await fetchOpenTabs()).toEqual([])
  })

  it('throws on error', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
    }
    supabase.from.mockReturnValue(chain)
    await expect(fetchOpenTabs()).rejects.toThrow('DB error')
  })
})

describe('fetchTabOrders', () => {
  // The function makes TWO calls: from('members').select(last_settled_at)
  // then from('orders').select(...).eq().eq().gt('created_at', since).order().
  // Helper builds dual mock chains keyed by table.
  function setupMocks({ lastSettledAt = null, orders = [], ordersError = null, memberError = null } = {}) {
    const memberChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: memberError ? null : { last_settled_at: lastSettledAt },
        error: memberError,
      }),
    }
    const ordersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: orders, error: ordersError }),
    }
    supabase.from.mockImplementation((table) => {
      if (table === 'members') return memberChain
      if (table === 'orders')  return ordersChain
      return {}
    })
    return { memberChain, ordersChain }
  }

  it('fetches orders for a member filtered by tab payment method', async () => {
    const orders = [
      {
        id: 'o1',
        created_at: '2026-03-30T20:00:00Z',
        total_amount: 15.50,
        order_items: [
          { id: 'oi1', product_id: 'p1', quantity: 2, unit_price: 5.50, products: { name: 'Guinness' } },
        ],
      },
    ]
    const { ordersChain } = setupMocks({ orders })

    const result = await fetchTabOrders('m1')
    expect(supabase.from).toHaveBeenCalledWith('members')
    expect(supabase.from).toHaveBeenCalledWith('orders')
    expect(ordersChain.eq).toHaveBeenCalledWith('member_id', 'm1')
    expect(ordersChain.eq).toHaveBeenCalledWith('payment_method', 'tab')
    expect(ordersChain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result).toEqual(orders)
  })

  it('filters by created_at > last_settled_at when set', async () => {
    const since = '2026-04-15T10:00:00Z'
    const { ordersChain } = setupMocks({ lastSettledAt: since })
    await fetchTabOrders('m1')
    expect(ordersChain.gt).toHaveBeenCalledWith('created_at', since)
  })

  it('uses epoch as fallback when last_settled_at is null', async () => {
    const { ordersChain } = setupMocks({ lastSettledAt: null })
    await fetchTabOrders('m1')
    expect(ordersChain.gt).toHaveBeenCalledWith('created_at', '1970-01-01')
  })

  it('returns empty array when member has no tab orders', async () => {
    setupMocks({ orders: [] })
    expect(await fetchTabOrders('m1')).toEqual([])
  })

  it('throws on error', async () => {
    setupMocks({ ordersError: { message: 'DB error' } })
    await expect(fetchTabOrders('m1')).rejects.toThrow('DB error')
  })
})

describe('adjustTabBalance', () => {
  it('inserts a tab_adjustments row and updates member balance', async () => {
    const adjInsert = vi.fn().mockResolvedValue({ error: null })
    const memberSelect = vi.fn().mockReturnThis()
    const memberEq = vi.fn().mockReturnThis()
    const memberSingle = vi.fn().mockResolvedValue({ data: { tab_balance: 20 }, error: null })
    const memberUpdate = vi.fn().mockReturnThis()
    const memberEqUpdate = vi.fn().mockResolvedValue({ error: null })

    supabase.from.mockImplementation((table) => {
      if (table === 'tab_adjustments') return { insert: adjInsert }
      if (table === 'members') return {
        select: memberSelect,
        eq: memberEq,
        single: memberSingle,
        update: memberUpdate,
      }
      return {}
    })
    memberUpdate.mockReturnValue({ eq: memberEqUpdate })

    await adjustTabBalance('member-1', -5, 'wrote off error', 'staff-1')

    expect(adjInsert).toHaveBeenCalledWith({
      member_id: 'member-1',
      amount: -5,
      reason: 'wrote off error',
      staff_id: 'staff-1',
    })
  })

  it('throws if adjustment insert fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
    })
    await expect(adjustTabBalance('m1', -5, 'reason', 's1')).rejects.toThrow('db error')
  })
})

describe('removeOrderFromTab', () => {
  it('sets order payment_method to removed and deducts from tab balance', async () => {
    const orderUpdate = vi.fn().mockReturnThis()
    const orderEq = vi.fn().mockResolvedValue({ error: null })
    const memberSelect = vi.fn().mockReturnThis()
    const memberEq = vi.fn().mockReturnThis()
    const memberSingle = vi.fn().mockResolvedValue({ data: { tab_balance: 20 }, error: null })
    const memberUpdate = vi.fn().mockReturnThis()
    const memberEqUpdate = vi.fn().mockResolvedValue({ error: null })

    supabase.from.mockImplementation((table) => {
      if (table === 'orders') return { update: orderUpdate, eq: orderEq }
      if (table === 'members') return {
        select: memberSelect,
        eq: memberEq,
        single: memberSingle,
        update: memberUpdate,
      }
      return {}
    })
    orderUpdate.mockReturnValue({ eq: orderEq })
    memberUpdate.mockReturnValue({ eq: memberEqUpdate })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    expect(orderUpdate).toHaveBeenCalledWith({ payment_method: 'removed' })
  })
})
