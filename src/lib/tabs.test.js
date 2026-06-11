// src/lib/tabs.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
import { supabase } from './supabase'
import { fetchOpenTabs, fetchTabOrders, adjustTabBalance, removeOrderFromTab, applyTabDelta } from './tabs'

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

describe('applyTabDelta', () => {
  it('calls the adjust_tab_balance RPC and returns the new balance as a number', async () => {
    supabase.rpc.mockResolvedValue({ data: '12.50', error: null })
    const result = await applyTabDelta('member-1', -5)
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -5,
    })
    expect(result).toBe(12.50)
  })

  it('throws when the RPC returns an error', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'member not found' } })
    await expect(applyTabDelta('member-1', -5)).rejects.toThrow('member not found')
  })
})

describe('adjustTabBalance', () => {
  it('inserts a tab_adjustments audit row and applies the delta via the RPC', async () => {
    supabase.__configure({ tab_adjustments: { error: null } })
    supabase.rpc.mockResolvedValue({ data: 15, error: null })

    await adjustTabBalance('member-1', -5, 'wrote off error', 'staff-1')

    expect(supabase.__chain('tab_adjustments').insert).toHaveBeenCalledWith({
      member_id: 'member-1',
      amount: -5,
      reason: 'wrote off error',
      staff_id: 'staff-1',
    })
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -5,
    })
  })

  it('throws if adjustment insert fails (and does not touch the balance)', async () => {
    supabase.__configure({
      tab_adjustments: { error: { message: 'db error' } },
    })
    await expect(adjustTabBalance('m1', -5, 'reason', 's1')).rejects.toThrow('db error')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe('removeOrderFromTab', () => {
  it('voids the order, restocks line items, and deducts from tab balance atomically', async () => {
    supabase.__configure({
      order_items: {
        data: [
          { product_id: 'prod-a', quantity: 2 },
          { product_id: 'prod-b', quantity: 1 },
        ],
      },
      stock_movements: { error: null },
      orders: { error: null },
    })
    supabase.rpc.mockResolvedValue({ data: 4.5, error: null })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    // Voids the order
    expect(supabase.__chain('orders').update).toHaveBeenCalledWith({ status: 'voided' })
    // Inserts restock movements (DB trigger handles stock_quantity update)
    expect(supabase.__chain('stock_movements').insert).toHaveBeenCalledWith([
      expect.objectContaining({ product_id: 'prod-a', type: 'restock', quantity: 2 }),
      expect.objectContaining({ product_id: 'prod-b', type: 'restock', quantity: 1 }),
    ])
    // Deducts the order total via the atomic RPC, not read-modify-write
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_tab_balance', {
      p_member_id: 'member-1',
      p_delta: -15.50,
    })
  })

  it('does not restock staff-credit lines and cancels their banked credits', async () => {
    supabase.__configure({
      order_items: {
        data: [
          { product_id: 'prod-a', quantity: 1, staff_credit_for: null },
          // "One for staff" line: no sale movement was ever written for it,
          // so restocking it on void would inflate stock.
          { product_id: 'prod-b', quantity: 1, staff_credit_for: 'staff-1' },
        ],
      },
      stock_movements: { error: null },
      orders: { error: null },
      staff_drink_credits: { error: null },
    })
    supabase.rpc.mockResolvedValue({ data: 4.5, error: null })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    expect(supabase.__chain('stock_movements').insert).toHaveBeenCalledWith([
      expect.objectContaining({ product_id: 'prod-a', type: 'restock', quantity: 1 }),
    ])
    // The banked (unredeemed) credits from this order are withdrawn
    const creditsChain = supabase.__chain('staff_drink_credits')
    expect(creditsChain.update).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(creditsChain.eq).toHaveBeenCalledWith('order_id', 'order-1')
    expect(creditsChain.eq).toHaveBeenCalledWith('status', 'banked')
  })
})
