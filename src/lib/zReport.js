import { supabase } from './supabase'
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'
import { fetchCashbackForDate } from './cashback'
import { fetchPrizeWinsForDate } from './prizeWins'

function getWeekStartISO(dateStr) {
  // Pub week runs Saturday–Friday
  const d = new Date(`${dateStr}T12:00:00Z`)
  const day = d.getUTCDay() // 0=Sun,1=Mon,...,6=Sat
  const diff = -((day - 6 + 7) % 7)  // days back to most recent Saturday
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

/**
 * Fetch all data needed for a Z report for a given date (YYYY-MM-DD).
 * Returns { salesSummary, topProducts, wastage, staffDrinks }.
 */
export async function fetchZReportData(date) {
  const from = `${date}T00:00:00`
  const to   = `${date}T23:59:59`

  // 1. Fetch all orders for the date (paid + refunded), with order_items so we
  // can distinguish real sales (have items) from tab settlements (no items)
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, total_amount, payment_method, status, order_items(id)')
    .gte('created_at', from)
    .lte('created_at', to)

  if (ordersError) throw ordersError

  const allOrders = orders ?? []
  const paid    = allOrders.filter(o => o.status === 'paid')
  const refunds = allOrders.filter(o => o.status === 'refunded')

  // A tab settlement creates an order with no order_items — it's just a
  // payment record clearing past debt, not a new sale. Excluding these from
  // revenue prevents double-counting (the original tab order already
  // recognised the revenue when the drinks were served).
  const sales       = paid.filter(o => (o.order_items ?? []).length > 0)
  const settlements = paid.filter(o => (o.order_items ?? []).length === 0)

  const sum = (arr) => arr.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const sumBy = (arr, method) => sum(arr.filter(o => o.payment_method === method))

  const refundsTotal     = sum(refunds)
  const transactionCount = sales.length
  const cashTotal = sumBy(paid, 'cash')           // all cash hitting drawer
  const cardTotal = sumBy(paid, 'card')           // all card payments
  const tabTotal  = sumBy(sales, 'tab')           // new tab orders today
  const cashSalesOnly = sumBy(sales, 'cash')      // real cash sales (items)
  const cardSalesOnly = sumBy(sales, 'card')      // real card sales (items)
  const settlementsTotal = sum(settlements)
  // Trading revenue = drinks served today, regardless of payment method
  const totalRevenue = cashSalesOnly + cardSalesOnly + tabTotal
  const netRevenue   = totalRevenue - refundsTotal

  const salesSummary = {
    totalRevenue,
    transactionCount,
    cashTotal,
    cardTotal,
    tabTotal,
    cashSalesOnly,
    cardSalesOnly,
    settlementsTotal,
    refundsTotal,
    netRevenue,
  }

  // 2. Fetch order items for the date to build top products
  const orderIds = allOrders.map(o => o.id)
  let topProducts = []

  if (orderIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity, unit_price, products(name)')
      .in('order_id', orderIds)

    if (itemsError) throw itemsError

    const map = {}
    ;(items ?? []).forEach(item => {
      const key = item.product_id
      const name = item.products?.name ?? 'Unknown'
      const qty = item.quantity ?? 0
      const revenue = qty * (item.unit_price ?? 0)
      if (!map[key]) {
        map[key] = { name, qty: 0, revenue: 0 }
      }
      map[key].qty     += qty
      map[key].revenue += revenue
    })

    topProducts = Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }

  const monday = getWeekStartISO(date)
  const weekFrom = `${monday}T00:00:00`
  const weekTo   = `${date}T23:59:59`

  const { data: weekOrders } = await supabase
    .from('orders')
    .select('total_amount, payment_method, status, order_items(id)')
    .gte('created_at', weekFrom)
    .lte('created_at', weekTo)
    .eq('status', 'paid')

  // Trading revenue across the week — exclude settlements (no items)
  const weekToDateRevenue = (weekOrders ?? [])
    .filter(o => (o.order_items ?? []).length > 0)
    .reduce((s, o) => s + (o.total_amount ?? 0), 0)

  const { data: tabData } = await supabase
    .from('members')
    .select('tab_balance')
    .gt('tab_balance', 0)
  const outstandingTabs = (tabData ?? []).reduce((s, m) => s + Number(m.tab_balance), 0)

  const [wastage, staffDrinks, cashbackTotal, prizeWins] = await Promise.all([
    fetchWastageForDate(date),
    fetchStaffDrinksForDate(date),
    fetchCashbackForDate(date),
    fetchPrizeWinsForDate(date),
  ])

  return { salesSummary, topProducts, wastage, staffDrinks, cashbackTotal, prizeWins, weekToDateRevenue, outstandingTabs }
}
