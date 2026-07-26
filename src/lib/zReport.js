import { supabase } from './supabase'
import { fetchAllPages } from './fetchAllPages'
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'
import { fetchCashbackForDate, fetchCashbackByTillForDate } from './cashback'
import { fetchPrizeWinsForDate } from './prizeWins'
import { tradingDayRange, tradingRange, tradingDayOf, addDaysISO } from './tradingDay'

function getWeekStartISO(dateStr) {
  // Pub week runs Saturday–Friday
  const d = new Date(`${dateStr}T12:00:00Z`)
  const day = d.getUTCDay() // 0=Sun,1=Mon,...,6=Sat
  const diff = -((day - 6 + 7) % 7)  // days back to most recent Saturday
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

function isWeekEnd(dateStr) {
  // Pub week ends Friday (UTC day = 5)
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 5
}

async function buildWeekSummary(date) {
  const weekStart = getWeekStartISO(date)
  const { from: weekFrom, to: weekTo } = tradingRange(weekStart, date)
  const prevWeekEnd   = addDaysISO(weekStart, -1)        // previous Friday
  const prevWeekStart = addDaysISO(prevWeekEnd, -6)      // previous Saturday

  // All paid cash+card orders this week — paginated: a busy week pushes
  // past the 1000-row PostgREST cap, which would silently clip revenue
  const weekOrders = await fetchAllPages(() => supabase
    .from('orders')
    .select('id, total_amount, payment_method, created_at, status')
    .gte('created_at', weekFrom)
    .lt('created_at', weekTo)
    .eq('status', 'paid')
    .in('payment_method', ['cash', 'card']))

  // Daily breakdown Sat → Fri
  const dailyMap = {}
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(weekStart, i)
    if (d > date) break  // don't include future days
    dailyMap[d] = { date: d, cash: 0, card: 0, total: 0 }
  }
  for (const o of weekOrders) {
    const day = tradingDayOf(o.created_at)
    if (!dailyMap[day]) continue
    const amt = o.total_amount ?? 0
    if (o.payment_method === 'cash') dailyMap[day].cash += amt
    else if (o.payment_method === 'card') dailyMap[day].card += amt
    dailyMap[day].total += amt
  }
  const daily = Object.values(dailyMap)
  const weekRevenue = daily.reduce((s, d) => s + d.total, 0)

  // Top products this week — joined server-side on the parent order: a
  // week of order ids is far too many to pass as an .in() URL filter
  const items = await fetchAllPages(() => supabase
    .from('order_items')
    .select('product_id, quantity, unit_price, products(name), orders!inner(created_at, status, payment_method)')
    .gte('orders.created_at', weekFrom)
    .lt('orders.created_at', weekTo)
    .eq('orders.status', 'paid')
    .in('orders.payment_method', ['cash', 'card']))
  const map = {}
  for (const it of items) {
    const k = it.product_id
    if (!map[k]) map[k] = { name: it.products?.name ?? 'Unknown', qty: 0, revenue: 0 }
    map[k].qty += it.quantity ?? 0
    map[k].revenue += (it.quantity ?? 0) * (it.unit_price ?? 0)
  }
  const topProducts = Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  // Wastage / staff drinks totals across the week
  const wasteRows = await fetchAllPages(() => supabase
    .from('stock_movements')
    .select('quantity, type, products(standard_price)')
    .in('type', ['wastage', 'staff_drink'])
    .gte('created_at', weekFrom)
    .lt('created_at', weekTo))
  const wastageTotal     = wasteRows.filter(r => r.type === 'wastage')
    .reduce((s, r) => s + r.quantity * (r.products?.standard_price ?? 0), 0)
  const staffDrinksTotal = wasteRows.filter(r => r.type === 'staff_drink')
    .reduce((s, r) => s + r.quantity * (r.products?.standard_price ?? 0), 0)

  // Previous full week revenue for w-o-w change
  const prevWeek = tradingRange(prevWeekStart, prevWeekEnd)
  const prevOrders = await fetchAllPages(() => supabase
    .from('orders')
    .select('total_amount')
    .gte('created_at', prevWeek.from)
    .lt('created_at', prevWeek.to)
    .eq('status', 'paid')
    .in('payment_method', ['cash', 'card']))
  const previousWeekRevenue = prevOrders.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const weekOnWeekDelta = previousWeekRevenue > 0
    ? ((weekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100
    : null

  return {
    weekStart,
    weekEnd: date,
    daily,
    weekRevenue,
    topProducts,
    wastageTotal,
    staffDrinksTotal,
    previousWeekRevenue,
    weekOnWeekDelta,
  }
}

/**
 * Fetch all data needed for a Z report for a given date (YYYY-MM-DD).
 * Returns { salesSummary, topProducts, wastage, staffDrinks }.
 */
export async function fetchZReportData(date) {
  // Trading-day window (06:00 to 06:00): a match night that runs past
  // midnight still reconciles as one session on this Z report.
  const { from, to } = tradingDayRange(date)

  // Fetch all orders for the date (paid + refunded). Cash-basis accounting:
  // revenue = cash + card actually received (whether on a sale or a tab
  // settlement — both put real money in the till). Tab orders are IOUs, not
  // revenue, so they're excluded entirely; what's owed lives on
  // members.tab_balance and surfaces as Outstanding Tabs.
  const allOrders = await fetchAllPages(() => supabase
    .from('orders')
    .select('id, total_amount, payment_method, status, till_id')
    .gte('created_at', from)
    .lt('created_at', to))
  const paid    = allOrders.filter(o => o.status === 'paid')
  const refunds = allOrders.filter(o => o.status === 'refunded')

  const sum   = (arr) => arr.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const sumBy = (arr, method) => sum(arr.filter(o => o.payment_method === method))

  const cashTotal    = sumBy(paid, 'cash')
  const cardTotal    = sumBy(paid, 'card')
  const totalRevenue = cashTotal + cardTotal
  const refundsTotal = sum(refunds)
  const netRevenue   = totalRevenue - refundsTotal

  // Per-till cash and card breakdowns (default each till to 0 even if no
  // orders today). Cash drives the per-till variance calc; card is
  // visibility-only (goes to bank, not the till drawer).
  const cashTotalByTill = { 'till-1': 0, 'till-2': 0 }
  const cardTotalByTill = { 'till-1': 0, 'till-2': 0 }
  paid.forEach(o => {
    const t = o.till_id || 'till-1'
    if (o.payment_method === 'cash') {
      cashTotalByTill[t] = (cashTotalByTill[t] ?? 0) + (o.total_amount ?? 0)
    } else if (o.payment_method === 'card') {
      cardTotalByTill[t] = (cardTotalByTill[t] ?? 0) + (o.total_amount ?? 0)
    }
  })

  const salesSummary = {
    totalRevenue,
    transactionCount: paid.filter(o => o.payment_method !== 'tab').length,
    cashTotal,
    cashTotalByTill,
    cardTotal,
    cardTotalByTill,
    refundsTotal,
    netRevenue,
  }

  // 2. Order items for the date to build top products — joined server-side
  // on the parent order's created_at: a busy day's worth of order ids made
  // the old .in() filter URL grow without bound.
  const items = await fetchAllPages(() => supabase
    .from('order_items')
    .select('product_id, quantity, unit_price, products(name), orders!inner(created_at)')
    .gte('orders.created_at', from)
    .lt('orders.created_at', to))

  const map = {}
  items.forEach(item => {
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

  const topProducts = Object.values(map)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  const weekStart = getWeekStartISO(date)
  const { from: weekFrom, to: weekTo } = tradingRange(weekStart, date)

  const weekOrders = await fetchAllPages(() => supabase
    .from('orders')
    .select('total_amount, payment_method, status')
    .gte('created_at', weekFrom)
    .lt('created_at', weekTo)
    .eq('status', 'paid')
    .in('payment_method', ['cash', 'card']))

  const weekToDateRevenue = weekOrders.reduce((s, o) => s + (o.total_amount ?? 0), 0)

  const { data: tabData } = await supabase
    .from('members')
    .select('tab_balance')
    .gt('tab_balance', 0)
  const outstandingTabs = (tabData ?? []).reduce((s, m) => s + Number(m.tab_balance), 0)

  const [wastage, staffDrinks, cashbackTotal, cashbackByTill, prizeWins] = await Promise.all([
    fetchWastageForDate(date),
    fetchStaffDrinksForDate(date),
    fetchCashbackForDate(date),
    fetchCashbackByTillForDate(date),
    fetchPrizeWinsForDate(date),
  ])

  // Weekly summary only on the trading-week end (Friday). Closing on any
  // other day still produces the standard daily report.
  const weekSummary = isWeekEnd(date) ? await buildWeekSummary(date) : null

  return { salesSummary, topProducts, wastage, staffDrinks, cashbackTotal, cashbackByTill, prizeWins, weekToDateRevenue, outstandingTabs, weekSummary }
}
