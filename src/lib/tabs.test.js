// src/lib/tabs.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
import { supabase } from './supabase'
import { fetchOpenTabs, fetchTabOrders, adjustTabBalance, removeOrderFromTab } from './tabs'

beforeEach(() => supabase.__reset())

describe('fetchOpenTabs', () => {
  it('returns members with tab_balance > 0 ordered by balance desc', async () => {
    const members = [
      { id: 'm1', name: 'Alice', tab_balance: 15.50, membership_number: 'M0001' },
      { id: 'm2', name: 'Bob', tab_balance: 8.00, membership_number: 'M0002' },
    ]
    supabase.__configure({ members: { data: members } })

    const result = await fetchOpenTabs()
    const chain = supabase.__chain('members')
    expect(supabase.from).toHaveBeenCalledWith('members')
    expect(chain.select).toHaveBeenCalledWith('id, name, tab_balance, membership_number')
    expect(chain.gt).toHaveBeenCalledWith('tab_balance', 0)
    expect(chain.order).toHaveBeenCalledWith('tab_balance', { ascending: false })
    expect(result).toEqual(members)
  })

  it('returns empty array when no open tabs', async () => {
    supabase.__configure({ members: { data: [] } })
    expect(await fetchOpenTabs()).toEqual([])
  })

  it('throws on error', async () => {
    supabase.__configure({ members: { data: null, error: { message: 'DB error' } } })
    await expect(fetchOpenTabs()).rejects.toThrow('DB error')
  })
})

describe('fetchTabOrders', () => {
  // The function makes TWO calls: from('members').select(last_settled_at)
  // then from('orders').select(...).eq().eq().neq().gt('created_at', since).order().
  function setupMocks({ lastSettledAt = null, orders = [], ordersError = null, memberError = null } = {}) {
    supabase.__configure({
      members: { data: memberError ? null : { last_settled_at: lastSettledAt }, error: memberError },
      orders: { data: ordersError ? null : orders, error: ordersError },
    })
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
    setupMocks({ orders })

    const result = await fetchTabOrders('m1')
    const ordersChain = supabase.__chain('orders')
    expect(supabase.from).toHaveBeenCalledWith('members')
    expect(supabase.from).toHaveBeenCalledWith('orders')
    expect(ordersChain.eq).toHaveBeenCalledWith('member_id', 'm1')
    expect(ordersChain.eq).toHaveBeenCalledWith('payment_method', 'tab')
    expect(ordersChain.neq).toHaveBeenCalledWith('status', 'voided')
    expect(ordersChain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result).toEqual(orders)
  })

  it('filters by created_at > last_settled_at when set', async () => {
    const since = '2026-04-15T10:00:00Z'
    setupMocks({ lastSettledAt: since })
    await fetchTabOrders('m1')
    expect(supabase.__chain('orders').gt).toHaveBeenCalledWith('created_at', since)
  })

  it('uses epoch as fallback when last_settled_at is null', async () => {
    setupMocks({ lastSettledAt: null })
    await fetchTabOrders('m1')
    expect(supabase.__chain('orders').gt).toHaveBeenCalledWith('created_at', '1970-01-01')
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
    supabase.__configure({
      tab_adjustments: { error: null },
      // first call: select tab_balance, second call: update
      members: [{ data: { tab_balance: 20 } }, { error: null }],
    })

    await adjustTabBalance('member-1', -5, 'wrote off error', 'staff-1')

    expect(supabase.__chain('tab_adjustments').insert).toHaveBeenCalledWith({
      member_id: 'member-1',
      amount: -5,
      reason: 'wrote off error',
      staff_id: 'staff-1',
    })
    expect(supabase.__chain('members', 1).update).toHaveBeenCalledWith({ tab_balance: 15 })
  })

  it('throws if adjustment insert fails', async () => {
    supabase.__configure({
      tab_adjustments: { error: { message: 'db error' } },
    })
    await expect(adjustTabBalance('m1', -5, 'reason', 's1')).rejects.toThrow('db error')
  })
})

describe('removeOrderFromTab', () => {
  it('voids the order, restocks line items, and deducts from tab balance', async () => {
    supabase.__configure({
      order_items: {
        data: [
          { product_id: 'prod-a', quantity: 2 },
          { product_id: 'prod-b', quantity: 1 },
        ],
      },
      stock_movements: { error: null },
      orders: { error: null },
      // first call: select tab_balance, second call: update
      members: [{ data: { tab_balance: 20 } }, { error: null }],
    })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    // Voids the order
    expect(supabase.__chain('orders').update).toHaveBeenCalledWith({ status: 'voided' })
    // Inserts restock movements (DB trigger handles stock_quantity update)
    expect(supabase.__chain('stock_movements').insert).toHaveBeenCalledWith([
      expect.objectContaining({ product_id: 'prod-a', type: 'restock', quantity: 2 }),
      expect.objectContaining({ product_id: 'prod-b', type: 'restock', quantity: 1 }),
    ])
    // Deducts the order total from member tab balance
    expect(supabase.__chain('members', 1).update).toHaveBeenCalledWith({ tab_balance: 4.5 })
  })
})
