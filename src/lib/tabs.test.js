// src/lib/tabs.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
import { supabase } from './supabase'
import {
  fetchOpenTabs, fetchTabOrders, adjustTabBalance, removeOrderFromTab, applyTabDelta,
  tabStanding, fetchTabAges, setTabBlocked, isTabBlocked, TAB_OVERDUE_DAYS,
} from './tabs'

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
    expect(chain.gt).toHaveBeenCalledWith('tab_balance', 0)
    expect(chain.order).toHaveBeenCalledWith('tab_balance', { ascending: false })
    expect(result.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(result[0]).toMatchObject({ name: 'Alice', tab_balance: 15.50 })
  })

  it('adds how long each tab has gone unpaid and whether it is blocked', async () => {
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()
    supabase.__configure({
      members: {
        data: [
          { id: 'm1', name: 'Alice', tab_balance: 15.50, tab_blocked: true },
          { id: 'm2', name: 'Bob', tab_balance: 8.00 },
        ],
      },
    })
    supabase.rpc.mockResolvedValue({
      data: [
        { member_id: 'm1', unpaid_since: daysAgo(30), last_paid_at: daysAgo(30) },
        { member_id: 'm2', unpaid_since: daysAgo(3), last_paid_at: null },
      ],
      error: null,
    })

    const result = await fetchOpenTabs()
    expect(supabase.rpc).toHaveBeenCalledWith('open_tab_ages', { p_member_id: null })
    expect(result[0]).toMatchObject({ id: 'm1', days: 30, overdue: true, tab_blocked: true })
    expect(result[1]).toMatchObject({ id: 'm2', days: 3, overdue: false, tab_blocked: false })
  })

  it('still returns the tabs when the age lookup fails', async () => {
    supabase.__configure({ members: { data: [{ id: 'm1', name: 'Alice', tab_balance: 15.50 }] } })
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await fetchOpenTabs()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'm1', days: null, overdue: false })
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
  const OPEN_TAB_ORDER = { data: { status: 'paid', payment_method: 'tab', created_at: '2026-11-16T13:48:58Z' } }

  it('refuses to remove a drink from a tab that has since been paid off, writing nothing', async () => {
    // 16 Nov: tab settled at 14:48, a stale Tabs page then removed a 13:48 drink
    supabase.__configure({
      orders: [OPEN_TAB_ORDER],
      members: { data: { last_settled_at: '2026-11-16T14:48:35Z' } },
    })

    await expect(removeOrderFromTab('order-1', 'member-1', 5)).rejects.toThrow(/already been paid off/)
    expect(supabase.from).not.toHaveBeenCalledWith('stock_movements')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('refuses when the order is already voided (removed on the other till)', async () => {
    supabase.__configure({
      orders: [{ data: { status: 'voided', payment_method: 'tab', created_at: '2026-11-16T13:48:58Z' } }],
      members: { data: { last_settled_at: null } },
    })

    await expect(removeOrderFromTab('order-1', 'member-1', 5)).rejects.toThrow(/no longer on the tab/)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('voids the order, restocks line items, and deducts from tab balance atomically', async () => {
    supabase.__configure({
      order_items: {
        data: [
          { product_id: 'prod-a', quantity: 2 },
          { product_id: 'prod-b', quantity: 1 },
        ],
      },
      stock_movements: { error: null },
      orders: [OPEN_TAB_ORDER, { error: null }],
      members: { data: { last_settled_at: '2026-11-16T12:00:00Z' } },
    })
    supabase.rpc.mockResolvedValue({ data: 4.5, error: null })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    // Voids the order
    expect(supabase.__chain('orders', 1).update).toHaveBeenCalledWith({ status: 'voided' })
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
      orders: [OPEN_TAB_ORDER, { error: null }],
      members: { data: { last_settled_at: null } },
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

describe('tabStanding', () => {
  const now = new Date('2026-11-22T12:00:00Z')

  it('counts whole days since the last payment', () => {
    expect(tabStanding('2026-11-19T13:00:00Z', now)).toEqual({ days: 2, overdue: false })
  })

  it('is overdue from the threshold day onwards', () => {
    const at = d => new Date(now.getTime() - d * 86400000).toISOString()
    expect(tabStanding(at(TAB_OVERDUE_DAYS - 1), now).overdue).toBe(false)
    expect(tabStanding(at(TAB_OVERDUE_DAYS), now)).toEqual({ days: TAB_OVERDUE_DAYS, overdue: true })
  })

  it('is never overdue when the age is unknown', () => {
    expect(tabStanding(null, now)).toEqual({ days: null, overdue: false })
  })
})

describe('fetchTabAges', () => {
  it('looks up a single member and keys the result by member id', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ member_id: 'm1', unpaid_since: '2020-01-01T00:00:00Z', last_paid_at: null }],
      error: null,
    })
    const ages = await fetchTabAges('m1')
    expect(supabase.rpc).toHaveBeenCalledWith('open_tab_ages', { p_member_id: 'm1' })
    expect(ages.m1.overdue).toBe(true)
    expect(ages.m1.last_paid_at).toBeNull()
  })

  it('throws on error', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
    await expect(fetchTabAges()).rejects.toThrow('nope')
  })
})

describe('setTabBlocked', () => {
  it('blocks the tab and records who did it', async () => {
    await setTabBlocked('m1', true, 'staff-1')
    const chain = supabase.__chain('members')
    expect(chain.update).toHaveBeenCalledWith({
      tab_blocked: true,
      tab_blocked_at: expect.any(String),
      tab_blocked_by: 'staff-1',
    })
    expect(chain.eq).toHaveBeenCalledWith('id', 'm1')
  })

  it('clears the block details when unblocking', async () => {
    await setTabBlocked('m1', false, 'staff-1')
    expect(supabase.__chain('members').update).toHaveBeenCalledWith({
      tab_blocked: false,
      tab_blocked_at: null,
      tab_blocked_by: null,
    })
  })

  it('throws on error', async () => {
    supabase.__configure({ members: { data: null, error: { message: 'denied' } } })
    await expect(setTabBlocked('m1', true)).rejects.toThrow('denied')
  })
})

describe('isTabBlocked', () => {
  it('returns the live flag', async () => {
    supabase.__configure({ members: { data: { tab_blocked: true } } })
    expect(await isTabBlocked('m1')).toBe(true)
  })

  it('does not block the sale when the lookup fails', async () => {
    supabase.__configure({ members: { data: null, error: { message: 'offline' } } })
    expect(await isTabBlocked('m1')).toBe(false)
  })
})
