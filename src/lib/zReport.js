import { supabase } from './supabase'
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'
import { fetchCashbackForDate } from './cashback'
import { fetchPrizeWinsForDate } from './prizeWins'

/**
 * Fetch all data needed for a Z report for a given date (YYYY-MM-DD).
 * Returns { salesSummary, topProducts, wastage, staffDrinks }.
 */
export async function fetchZReportData(date) {
  const from = `${date}T00:00:00`
  const to   = `${date}T23:59:59`

  // 1. Fetch all orders for the date (paid + refunded)
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, total_amount, payment_method, status')
    .gte('created_at', from)
    .lte('created_at', to)

  if (ordersError) throw ordersError

  const allOrders = orders ?? []
  const paid    = allOrders.filter(o => o.status === 'paid')
  const refunds = allOrders.filter(o => o.status === 'refunded')

  const sum = (arr) => arr.reduce((s, o) => s + (o.total_amount ?? 0), 0)

  const totalRevenue    = sum(paid)
  const refundsTotal    = sum(refunds)
  const transactionCount = paid.length
  const cashTotal = sum(paid.filter(o => o.payment_method === 'cash'))
  const cardTotal = sum(paid.filter(o => o.payment_method === 'card'))
  const tabTotal  = sum(paid.filter(o => o.payment_method === 'tab'))
  const netRevenue = totalRevenue - refundsTotal

  const salesSummary = {
    totalRevenue,
    transactionCount,
    cashTotal,
    cardTotal,
    tabTotal,
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

  const [wastage, staffDrinks, cashbackTotal, prizeWins] = await Promise.all([
    fetchWastageForDate(date),
    fetchStaffDrinksForDate(date),
    fetchCashbackForDate(date),
    fetchPrizeWinsForDate(date),
  ])

  return { salesSummary, topProducts, wastage, staffDrinks, cashbackTotal, prizeWins }
}
