import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchZReportData } from './zReport'
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'

vi.mock('./stockMovements', () => ({
  fetchWastageForDate: vi.fn().mockResolvedValue([]),
  fetchStaffDrinksForDate: vi.fn().mockResolvedValue([]),
}))

// ---------- Supabase mock ----------
// We need two independent call chains: one for orders, one for order_items.
// We track which table was called and return different data per table.

let ordersData = []
let orderItemsData = []

vi.mock('./supabase', () => {
  const makeChain = (getData) => {
    const chain = {
      select: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
    }

    chain.select.mockReturnValue(chain)
    chain.gte.mockReturnValue(chain)
    chain.lte.mockReturnValue(chain)
    // lte is the terminal call for orders, in is the terminal call for order_items
    chain.in.mockImplementation(() => Promise.resolve({ data: getData(), error: null }))
    chain.eq.mockImplementation(() => Promise.resolve({ data: getData(), error: null }))
    chain.lte.mockImplementation(() => Promise.resolve({ data: getData(), error: null }))
    return chain
  }

  return {
    supabase: {
      from: vi.fn((table) => {
        if (table === 'orders') return makeChain(() => ordersData)
        if (table === 'order_items') return makeChain(() => orderItemsData)
        return makeChain(() => [])
      }),
    },
  }
})

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

beforeEach(() => {
  ordersData = []
  orderItemsData = []
  fetchWastageForDate.mockResolvedValue([])
  fetchStaffDrinksForDate.mockResolvedValue([])
})

describe('fetchZReportData — salesSummary', () => {
  it('totalRevenue sums only paid orders', async () => {
    ordersData = [paidCash, paidCard, refunded]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.totalRevenue).toBe(30.00)
  })

  it('transactionCount counts only paid orders', async () => {
    ordersData = [paidCash, paidCard, paidTab, refunded]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.transactionCount).toBe(3)
  })

  it('cashTotal sums paid cash orders only', async () => {
    ordersData = [paidCash, paidCard, refunded]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.cashTotal).toBe(10.00)
  })

  it('cardTotal sums paid card orders only', async () => {
    ordersData = [paidCash, paidCard, paidTab]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.cardTotal).toBe(20.00)
  })

  it('tabTotal sums paid tab orders only', async () => {
    ordersData = [paidCash, paidCard, paidTab]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.tabTotal).toBe(5.50)
  })

  it('refundsTotal sums refunded order totals as a positive number', async () => {
    ordersData = [paidCash, refunded, { ...refunded, id: 'o5', total_amount: 3.00 }]
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.refundsTotal).toBe(11.00)
  })

  it('netRevenue = totalRevenue - refundsTotal', async () => {
    ordersData = [paidCash, paidCard, refunded]
    const { salesSummary } = await fetchZReportData(DATE)
    // paid: 30.00, refunded: 8.00
    expect(salesSummary.netRevenue).toBeCloseTo(22.00, 2)
  })

  it('returns all zeros when no orders', async () => {
    ordersData = []
    const { salesSummary } = await fetchZReportData(DATE)
    expect(salesSummary.totalRevenue).toBe(0)
    expect(salesSummary.transactionCount).toBe(0)
    expect(salesSummary.cashTotal).toBe(0)
    expect(salesSummary.cardTotal).toBe(0)
    expect(salesSummary.tabTotal).toBe(0)
    expect(salesSummary.refundsTotal).toBe(0)
    expect(salesSummary.netRevenue).toBe(0)
  })
})

describe('fetchZReportData — topProducts', () => {
  it('aggregates qty and revenue by product_id across multiple items', async () => {
    ordersData = [paidCash] // needs at least one order so orderIds is non-empty
    orderItemsData = [item1, item3] // both Guinness p1: qty 3+2=5, revenue 12+8=20
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Guinness')
    expect(topProducts[0].qty).toBe(5)
    expect(topProducts[0].revenue).toBeCloseTo(20.00, 2)
  })

  it('sorts products by revenue descending', async () => {
    ordersData = [paidCash]
    // item2: Lager 5 * 3.00 = 15.00, item1: Guinness 3 * 4.00 = 12.00
    orderItemsData = [item1, item2]
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Lager')
    expect(topProducts[1].name).toBe('Guinness')
  })

  it('limits to top 10 products', async () => {
    ordersData = [paidCash]
    orderItemsData = Array.from({ length: 15 }, (_, i) => ({
      product_id: `p${i}`,
      quantity: 1,
      unit_price: 15 - i, // descending revenue so all are distinct
      products: { name: `Product ${i}` },
    }))
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts.length).toBe(10)
  })

  it('returns empty array when no order items', async () => {
    ordersData = [paidCash]
    orderItemsData = []
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts).toEqual([])
  })

  it('uses "Unknown" for items with no product join', async () => {
    ordersData = [paidCash]
    orderItemsData = [{ product_id: 'p9', quantity: 1, unit_price: 5.00, products: null }]
    const { topProducts } = await fetchZReportData(DATE)
    expect(topProducts[0].name).toBe('Unknown')
  })
})

describe('fetchZReportData — wastage and staff drinks', () => {
  it('includes wastage in the result', async () => {
    fetchWastageForDate.mockResolvedValue([{ name: 'Guinness', quantity: 4, value: 29.60 }])
    const result = await fetchZReportData('2026-03-30')
    expect(result.wastage).toEqual([{ name: 'Guinness', quantity: 4, value: 29.60 }])
  })

  it('includes staffDrinks in the result', async () => {
    fetchStaffDrinksForDate.mockResolvedValue([{ name: 'Dave', items: 2, value: 13.40 }])
    const result = await fetchZReportData('2026-03-30')
    expect(result.staffDrinks).toEqual([{ name: 'Dave', items: 2, value: 13.40 }])
  })

  it('returns empty arrays when no wastage or staff drinks', async () => {
    const result = await fetchZReportData('2026-03-30')
    expect(result.wastage).toEqual([])
    expect(result.staffDrinks).toEqual([])
  })
})
