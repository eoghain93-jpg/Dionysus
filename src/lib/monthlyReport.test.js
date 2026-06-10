import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
import { supabase } from './supabase'
import { fetchMonthlyReportData, monthRange, monthLabel, toCsv } from './monthlyReport'

const MONTH = '2026-05'

const paidCash = (day, amount, id = `${day}-c`) =>
  ({ id, total_amount: amount, payment_method: 'cash', status: 'paid', created_at: `2026-05-${day}T20:00:00` })
const paidCard = (day, amount, id = `${day}-k`) =>
  ({ id, total_amount: amount, payment_method: 'card', status: 'paid', created_at: `2026-05-${day}T20:30:00` })
const paidTab = (day, amount, id = `${day}-t`) =>
  ({ id, total_amount: amount, payment_method: 'tab', status: 'paid', created_at: `2026-05-${day}T21:00:00` })
const refundedCash = (day, amount, id = `${day}-r`) =>
  ({ id, total_amount: amount, payment_method: 'cash', status: 'refunded', created_at: `2026-05-${day}T22:00:00` })

beforeEach(() => supabase.__reset())

describe('monthRange / monthLabel', () => {
  it('computes correct bounds for May 2026', () => {
    expect(monthRange('2026-05')).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
      from: '2026-05-01T00:00:00',
      to: '2026-05-31T23:59:59',
    })
  })

  it('handles February in a leap year', () => {
    expect(monthRange('2028-02').end).toBe('2028-02-29')
  })

  it('labels the month for humans', () => {
    expect(monthLabel('2026-05')).toBe('May 2026')
  })
})

describe('fetchMonthlyReportData — daily breakdown', () => {
  it('sums cash and card per day, excluding tab orders from takings', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 10), paidCard('04', 20), paidTab('04', 99), paidCash('05', 5)] },
    })
    const { daily } = await fetchMonthlyReportData(MONTH)
    const may4 = daily.find(d => d.date === '2026-05-04')
    const may5 = daily.find(d => d.date === '2026-05-05')
    expect(may4).toMatchObject({ cash: 10, card: 20, total: 30 })
    expect(may5).toMatchObject({ cash: 5, card: 0, total: 5 })
  })

  it('produces a row for every day of the month', async () => {
    const { daily } = await fetchMonthlyReportData(MONTH)
    expect(daily).toHaveLength(31)
    expect(daily[0].date).toBe('2026-05-01')
    expect(daily[30].date).toBe('2026-05-31')
  })

  it('counts settlement orders as takings (they are cash/card paid orders)', async () => {
    // settleTab inserts a plain cash/card order — nothing distinguishes it,
    // and that is the point: real money in the till counts
    supabase.__configure({ orders: { data: [paidCash('10', 15.5, 'settlement-1')] } })
    const { daily } = await fetchMonthlyReportData(MONTH)
    expect(daily.find(d => d.date === '2026-05-10').cash).toBe(15.5)
  })

  it('records refunds per day without netting them from takings', async () => {
    supabase.__configure({ orders: { data: [paidCash('08', 30), refundedCash('08', 8)] } })
    const { daily } = await fetchMonthlyReportData(MONTH)
    expect(daily.find(d => d.date === '2026-05-08')).toMatchObject({ cash: 30, refunds: 8 })
  })

  it('pages past the 1000-row PostgREST cap instead of silently truncating', async () => {
    // a real month is 3000+ orders; a full first page must trigger a second request
    const page1 = Array.from({ length: 1000 }, (_, i) => paidCash('04', 1, `bulk-${i}`))
    supabase.__configure({
      orders: [{ data: page1 }, { data: [paidCash('05', 10, 'last-one')] }],
    })
    const { totals } = await fetchMonthlyReportData(MONTH)
    expect(totals.revenue).toBe(1010)
    expect(supabase.__chains.orders).toHaveLength(2) // two pages requested
  })
})

describe('fetchMonthlyReportData — cash reconciliation', () => {
  it('computes expected cash and variance for closed days (Z report logic)', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 100)] },
      z_reports: { data: [{ report_date: '2026-05-04', opening_float: 200, actual_cash: 290 }] },
      cashback_transactions: { data: [{ amount: 10, created_at: '2026-05-04T19:00:00' }] },
      prize_wins: { data: [{ amount: 5, created_at: '2026-05-04T18:00:00' }] },
    })
    const { daily } = await fetchMonthlyReportData(MONTH)
    const day = daily.find(d => d.date === '2026-05-04')
    // expected = 200 float + 100 cash − 10 cashback − 5 prize wins = 285
    expect(day.expectedCash).toBe(285)
    expect(day.variance).toBe(5) // 290 actual − 285
  })

  it('leaves reconciliation null for days without a closed Z report', async () => {
    supabase.__configure({ orders: { data: [paidCash('04', 100)] } })
    const { daily } = await fetchMonthlyReportData(MONTH)
    const day = daily.find(d => d.date === '2026-05-04')
    expect(day.openingFloat).toBeNull()
    expect(day.variance).toBeNull()
  })

  it('sums variance across closed days only', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 100), paidCash('05', 50)] },
      z_reports: { data: [
        { report_date: '2026-05-04', opening_float: 200, actual_cash: 295 }, // variance −5
        { report_date: '2026-05-05', opening_float: 200, actual_cash: 252 }, // variance +2
        { report_date: '2026-05-06', opening_float: 200, actual_cash: null }, // not closed
      ] },
    })
    const { totals } = await fetchMonthlyReportData(MONTH)
    expect(totals.variance).toBeCloseTo(-3, 2)
    expect(totals.closedDayCount).toBe(2)
  })
})

describe('fetchMonthlyReportData — month totals', () => {
  it('computes revenue, transaction count (tabs excluded) and net revenue', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 10), paidCard('05', 20), paidTab('06', 99), refundedCash('07', 8)] },
    })
    const { totals } = await fetchMonthlyReportData(MONTH)
    expect(totals.revenue).toBe(30)
    expect(totals.transactionCount).toBe(2)
    expect(totals.refunds).toBe(8)
    expect(totals.netRevenue).toBe(22)
  })

  it('values wastage and staff drinks at standard price', async () => {
    supabase.__configure({
      stock_movements: { data: [
        { type: 'wastage', quantity: 4, products: { standard_price: 5.50 } },
        { type: 'wastage', quantity: 1, products: { standard_price: 4.00 } },
        { type: 'staff_drink', quantity: 2, products: { standard_price: 4.50 } },
      ] },
    })
    const { totals } = await fetchMonthlyReportData(MONTH)
    expect(totals.wastage).toBeCloseTo(26.00, 2)      // 4×5.50 + 1×4.00
    expect(totals.staffDrinks).toBeCloseTo(9.00, 2)   // 2×4.50
  })

  it('sums cashback and prize wins paid out', async () => {
    supabase.__configure({
      cashback_transactions: { data: [
        { amount: 20, created_at: '2026-05-09T19:00:00' },
        { amount: '10.50', created_at: '2026-05-16T19:00:00' },
      ] },
      prize_wins: { data: [{ amount: 25, created_at: '2026-05-23T19:00:00' }] },
    })
    const { totals } = await fetchMonthlyReportData(MONTH)
    expect(totals.cashback).toBeCloseTo(30.50, 2)
    expect(totals.prizeWins).toBe(25)
  })

  it('reports outstanding tabs from member balances', async () => {
    supabase.__configure({
      members: { data: [{ tab_balance: '10.50' }, { tab_balance: 5 }] },
    })
    const { outstandingTabs } = await fetchMonthlyReportData(MONTH)
    expect(outstandingTabs).toBeCloseTo(15.50, 2)
  })
})

describe('fetchMonthlyReportData — top products', () => {
  it('aggregates and sorts product sales by revenue', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 100)] },
      order_items: { data: [
        { product_id: 'p1', quantity: 3, unit_price: 4.00, products: { name: 'Guinness' } },
        { product_id: 'p2', quantity: 10, unit_price: 3.00, products: { name: 'Lager' } },
        { product_id: 'p1', quantity: 2, unit_price: 4.00, products: { name: 'Guinness' } },
      ] },
    })
    const { topProducts } = await fetchMonthlyReportData(MONTH)
    expect(topProducts[0]).toMatchObject({ name: 'Lager', qty: 10, revenue: 30 })
    expect(topProducts[1]).toMatchObject({ name: 'Guinness', qty: 5, revenue: 20 })
  })

  it('returns empty array when the month has no orders', async () => {
    const { topProducts } = await fetchMonthlyReportData(MONTH)
    expect(topProducts).toEqual([])
  })
})

describe('toCsv', () => {
  it('includes the daily section, totals and products', async () => {
    supabase.__configure({
      orders: { data: [paidCash('04', 10)] },
      order_items: { data: [
        { product_id: 'p1', quantity: 2, unit_price: 5.00, products: { name: 'Guinness, Draught' } },
      ] },
    })
    const data = await fetchMonthlyReportData(MONTH)
    const csv = toCsv(data)
    expect(csv).toContain('Monthly Report,May 2026')
    expect(csv).toContain('2026-05-04,10.00,0.00,10.00')
    expect(csv).toContain('Revenue (cash + card),10.00')
    expect(csv).toContain('Outstanding tabs')
    // commas stripped from product names so columns stay aligned
    expect(csv).toContain('Guinness  Draught,2,10.00')
  })
})
