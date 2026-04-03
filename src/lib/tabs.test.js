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
  it('fetches orders with items for a member filtered by tab payment method', async () => {
    const orders = [
      {
        id: 'o1',
        created_at: '2026-03-30T20:00:00Z',
        total_amount: 15.50,
        order_items: [
          { id: 'oi1', product_id: 'p1', quantity: 2, unit_price: 5.50, products: { name: 'Guinness' } },
          { id: 'oi2', product_id: 'p2', quantity: 1, unit_price: 4.50, products: { name: 'Coke' } },
        ],
      },
    ]
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: orders, error: null })),
    }
    supabase.from.mockReturnValue(chain)

    const result = await fetchTabOrders('m1')
    expect(supabase.from).toHaveBeenCalledWith('orders')
    expect(chain.select).toHaveBeenCalledWith('id, created_at, total_amount, order_items(id, product_id, quantity, unit_price, products(name))')
    expect(chain.eq).toHaveBeenCalledWith('member_id', 'm1')
    expect(chain.eq).toHaveBeenCalledWith('payment_method', 'tab')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result).toEqual(orders)
  })

  it('returns empty array when member has no tab orders', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
    }
    supabase.from.mockReturnValue(chain)
    expect(await fetchTabOrders('m1')).toEqual([])
  })

  it('throws on error', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
    }
    supabase.from.mockReturnValue(chain)
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
