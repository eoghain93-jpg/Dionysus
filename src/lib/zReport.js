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

  // Fetch all orders for the date (paid + refunded). Cash-basis accounting:
  // revenue = cash + card actually received (whether on a sale or a tab
  // settlement — both put real money in the till). Tab orders are IOUs, not
  // revenue, so they're excluded entirely; what's owed lives on
  // members.tab_balance and surfaces as Outstanding Tabs.
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, total_amount, payment_method, status')
    .gte('created_at', from)
    .lte('created_at', to)

  if (ordersError) throw ordersError

  const allOrders = orders ?? []
  const paid    = allOrders.filter(o => o.status === 'paid')
  const refunds = allOrders.filter(o => o.status === 'refunded')

  const sum   = (arr) => arr.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const sumBy = (arr, method) => sum(arr.filter(o => o.payment_method === method))

  const cashTotal    = sumBy(paid, 'cash')
  const cardTotal    = sumBy(paid, 'card')
  const totalRevenue = cashTotal + cardTotal
  const refundsTotal = sum(refunds)
  const netRevenue   = totalRevenue - refundsTotal

  const salesSummary = {
    totalRevenue,
    transactionCount: paid.filter(o => o.payment_method !== 'tab').length,
    cashTotal,
    cardTotal,
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
    .select('total_amount, payment_method, status')
    .gte('created_at', weekFrom)
    .lte('created_at', weekTo)
    .eq('status', 'paid')
    .in('payment_method', ['cash', 'card'])

  const weekToDateRevenue = (weekOrders ?? []).reduce((s, o) => s + (o.total_amount ?? 0), 0)

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
