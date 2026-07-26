import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchZReportData } from './zReport'
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'

vi.mock('./stockMovements', () => ({
  fetchWastageForDate: vi.fn().mockResolvedValue([]),
  fetchStaffDrinksForDate: vi.fn().mockResolvedValue([]),
}))

// Chainable Supabase mock — cashback_transactions, prize_wins and members
// queries default to empty data, so cashback/prize/outstanding-tab totals
// are 0 unless a test configures them.
vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
import { supabase } from './supabase'

// 2026-03-30 is a Monday, so the weekly (Friday-only) summary stays off.
const DATE = '2026-03-30'

// Sample orders
const paidCash  = { id: 'o1', total_amount: 10.00, payment_method: 'cash',  status: 'paid' }
const paidCard  = { id: 'o2', total_amount: 20.00, payment_method: 'card',  status: 'paid' }
const paidTab   = { id: 'o3', total_amount: 5.50,  payment_method: 'tab',   status: 'paid' }
const refunded  = { id: 'o4', total_amount: 8.00,  payment_method: 'cash',  status: 'refunded' }

// Sample order_items
const item1 = { product_id: 'p1', quantity: 3, unit_price: 4.00, products: { name: 'Guinness' } }
const item2 = { product_id: 'p2', quantity: 5, unit_price: 3.00, products: { name: 'Lager' } }
const item3 = { product_id: 'p1', quantity: 2, unit_price: 4.00, products: { name: 'Guinness' } }

function setOrders(orders) {
  supabase.__configure({ orders: { data: orders } })
}

function setOrderItems(items) {
  supabase.__configure({ order_items: { data: items } })
}

beforeEach(() => {
  supabase.__reset()
  fetchWastageForDate.mockResolvedValue([])
  fetchStaffDrinksForDate.mockResolvedValue([])
})

describe('fetchZReportData — salesSummary', () => {
  it('totalRevenue sums only paid orders', async () => {
    setOrders([paidCash, paidCard, refunded])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.totalRevenue).toBe(30.00)
  })

  it('transactionCount counts only paid cash/card orders (tabs excluded)', async () => {
    setOrders([paidCash, paidCard, paidTab, refunded])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.transactionCount).toBe(2)
  })

  it('cashTotal sums paid cash orders only', async () => {
    setOrders([paidCash, paidCard, refunded])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.cashTotal).toBe(10.00)
  })

  it('cardTotal sums paid card orders only', async () => {
    setOrders([paidCash, paidCard, paidTab])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.cardTotal).toBe(20.00)
  })

  it('excludes tab orders from revenue (cash-basis: tabs are IOUs, not takings)', async () => {
    setOrders([paidCash, paidCard, paidTab])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.totalRevenue).toBe(30.00)
    expect(salesSummary.tabTotal).toBeUndefined()
  })

  it('reports outstanding tabs from member balances, not orders', async () => {
    setOrders([paidTab])
    supabase.__configure({ members: { data: [{ tab_balance: '10.50' }, { tab_balance: 5 }] } })
    const { outstandingTabs } = await fetchZReportData(DATE)
    expect(outstandingTabs).toBeCloseTo(15.50, 2)
  })

  it('refundsTotal sums refunded order totals as a positive number', async () => {
    setOrders([paidCash, refunded, { ...refunded, id: 'o5', total_amount: 3.00 }])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.refundsTotal).toBe(11.00)
  })

  it('netRevenue = totalRevenue - refundsTotal', async () => {
    setOrders([paidCash, paidCard, refunded])
    const { salesSummary } = await fetchZReportData(DATE)
    // paid: 30.00, refunded: 8.00
    expect(salesSummary.netRevenue).toBeCloseTo(22.00, 2)
  })

  it('returns all zeros when no orders', async () => {
    setOrders([])
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.totalRevenue).toBe(0)
    expect(salesSummary.transactionCount).toBe(0)
    expect(salesSummary.cashTotal).toBe(0)
    expect(salesSummary.cardTotal).toBe(0)
    expect(salesSummary.refundsTotal).toBe(0)
    expect(salesSummary.netRevenue).toBe(0)
  })
})

describe('fetchZReportData — topProducts', () => {
  it('aggregates qty and revenue by product_id across multiple items', async () => {
    setOrders([paidCash]) // needs at least one order so orderIds is non-empty
    setOrderItems([item1, item3]) // both Guinness p1: qty 3+2=5, revenue 12+8=20
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Guinness')
    expect(topProducts[0].qty).toBe(5)
    expect(topProducts[0].revenue).toBeCloseTo(20.00, 2)
  })

  it('sorts products by revenue descending', async () => {
    setOrders([paidCash])
    // item2: Lager 5 * 3.00 = 15.00, item1: Guinness 3 * 4.00 = 12.00
    setOrderItems([item1, item2])
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Lager')
    expect(topProducts[1].name).toBe('Guinness')
  })

  it('limits to top 10 products', async () => {
    setOrders([paidCash])
    setOrderItems(Array.from({ length: 15 }, (_, i) => ({
      product_id: `p${i}`,
      quantity: 1,
      unit_price: 15 - i, // descending revenue so all are distinct
      products: { name: `Product ${i}` },
    })))
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts.length).toBe(10)
  })

  it('returns empty array when no order items', async () => {
    setOrders([paidCash])
    setOrderItems([])
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts).toEqual([])
  })

  it('uses "Unknown" for items with no product join', async () => {
    setOrders([paidCash])
    setOrderItems([{ product_id: 'p9', quantity: 1, unit_price: 5.00, products: null }])
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Unknown')
  })
})

describe('fetchZReportData — wastage and staff drinks', () => {
  it('includes wastage in the result', async () => {
    fetchWastageForDate.mockResolvedValue([{ name: 'Guinness', quantity: 4, value: 29.60 }])
    const result = await fetchZReportData(DATE)
    expect(result.wastage).toEqual([{ name: 'Guinness', quantity: 4, value: 29.60 }])
  })

  it('includes staffDrinks in the result', async () => {
    fetchStaffDrinksForDate.mockResolvedValue([{ name: 'Dave', items: 2, value: 13.40 }])
    const result = await fetchZReportData(DATE)
    expect(result.staffDrinks).toEqual([{ name: 'Dave', items: 2, value: 13.40 }])
  })

  it('returns empty arrays when no wastage or staff drinks', async () => {
    const result = await fetchZReportData(DATE)
    expect(result.wastage).toEqual([])
    expect(result.staffDrinks).toEqual([])
  })
})

describe('fetchZReportData — trading-day window', () => {
  // Hard-coded expected strings on purpose: deriving them from
  // tradingDayRange would make the test tautological.
  it('queries orders for 06:00 on the date to 06:00 the next morning, exclusive', async () => {
    setOrders([])
    await fetchZReportData(DATE)
    const chain = supabase.__chain('orders')
    expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-03-30T06:00:00')
    expect(chain.lt).toHaveBeenCalledWith('created_at', '2026-03-31T06:00:00')
  })

  it('queries order_items on the same trading-day window', async () => {
    setOrders([])
    await fetchZReportData(DATE)
    const chain = supabase.__chain('order_items')
    expect(chain.gte).toHaveBeenCalledWith('orders.created_at', '2026-03-30T06:00:00')
    expect(chain.lt).toHaveBeenCalledWith('orders.created_at', '2026-03-31T06:00:00')
  })
})

describe('fetchZReportData — Friday weekly summary', () => {
  // 2026-04-03 is a Friday (week runs Saturday 2026-03-28 → Friday).
  const FRIDAY = '2026-04-03'
  const weekRows = [
    { id: 'w1', total_amount: 30.00, payment_method: 'card', status: 'paid', created_at: '2026-04-01T19:00:00+00:00' },
    { id: 'w2', total_amount: 20.00, payment_method: 'cash', status: 'paid', created_at: '2026-04-03T20:00:00+00:00' },
    // 01:30 Saturday morning — Friday's session, must stay in Friday's
    // bucket and the closing week (the old calendar slice dropped it)
    { id: 'w3', total_amount: 15.00, payment_method: 'cash', status: 'paid', created_at: '2026-04-04T01:30:00+00:00' },
  ]

  it('buckets an after-midnight order onto the trading day that started it', async () => {
    setOrders(weekRows)
    const { weekSummary } = await fetchZReportData(FRIDAY)
    expect(weekSummary).not.toBeNull()
    expect(weekSummary.weekStart).toBe('2026-03-28')
    expect(weekSummary.weekEnd).toBe(FRIDAY)
    const friday = weekSummary.daily.find(d => d.date === FRIDAY)
    expect(friday).toMatchObject({ cash: 35.00, card: 0, total: 35.00 })
    const wednesday = weekSummary.daily.find(d => d.date === '2026-04-01')
    expect(wednesday).toMatchObject({ cash: 0, card: 30.00, total: 30.00 })
    expect(weekSummary.weekRevenue).toBe(65.00)
  })

  it('spans the week window from Saturday 06:00 to Saturday 06:00', async () => {
    setOrders(weekRows)
    await fetchZReportData(FRIDAY)
    // orders chains in creation order: day, week-to-date, week summary, prev week
    const weekChain = supabase.__chain('orders', 2)
    expect(weekChain.gte).toHaveBeenCalledWith('created_at', '2026-03-28T06:00:00')
    expect(weekChain.lt).toHaveBeenCalledWith('created_at', '2026-04-04T06:00:00')
    const prevChain = supabase.__chain('orders', 3)
    expect(prevChain.gte).toHaveBeenCalledWith('created_at', '2026-03-21T06:00:00')
    expect(prevChain.lt).toHaveBeenCalledWith('created_at', '2026-03-28T06:00:00')
  })
})
