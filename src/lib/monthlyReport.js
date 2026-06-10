import { supabase } from './supabase'

// Monthly accountant report builder.
//
// Cash-basis accounting, consistent with the daily Z reports: revenue is
// cash + card actually received (sales and tab settlements both count —
// real money either way). Tab orders are IOUs, excluded from revenue;
// what's owed surfaces as Outstanding Tabs. Wastage and staff drinks are
// valued at standard_price, matching the Z report.

/** First/last day bounds for a YYYY-MM month string. */
export function monthRange(monthISO) {
  const [year, month] = monthISO.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const start = `${monthISO}-01`
  const end = `${monthISO}-${String(lastDay).padStart(2, '0')}`
  return { start, end, from: `${start}T00:00:00`, to: `${end}T23:59:59` }
}

/** Human label, e.g. 'May 2026'. */
export function monthLabel(monthISO) {
  const [year, month] = monthISO.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

const sum = (arr, pick) => arr.reduce((s, r) => s + Number(pick(r) ?? 0), 0)

// PostgREST caps responses at 1000 rows; a month of pub trading is well
// past that (May 2026: 3,000+ orders), so every month-wide query pages
// through .range() until a short page signals the end.
const PAGE_SIZE = 1000

async function fetchAll(buildQuery) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * @param {string} monthISO  YYYY-MM
 */
export async function fetchMonthlyReportData(monthISO) {
  const { start, end, from, to } = monthRange(monthISO)

  const allOrders = await fetchAll(() => supabase
    .from('orders')
    .select('id, total_amount, payment_method, status, created_at')
    .gte('created_at', from)
    .lte('created_at', to))

  const { data: zReports, error: zErr } = await supabase
    .from('z_reports')
    .select('report_date, opening_float, actual_cash')
    .gte('report_date', start)
    .lte('report_date', end)
  if (zErr) throw zErr

  const waste = await fetchAll(() => supabase
    .from('stock_movements')
    .select('type, quantity, products(standard_price)')
    .in('type', ['wastage', 'staff_drink'])
    .gte('created_at', from)
    .lte('created_at', to))

  const { data: cashbackRows, error: cbErr } = await supabase
    .from('cashback_transactions')
    .select('amount, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
  if (cbErr) throw cbErr

  const { data: prizeRows, error: pwErr } = await supabase
    .from('prize_wins')
    .select('amount, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
  if (pwErr) throw pwErr

  // Outstanding tabs are a CURRENT snapshot — balance history isn't kept,
  // so this is "as of report generation", not "as at month end".
  const { data: tabRows, error: tErr } = await supabase
    .from('members')
    .select('tab_balance')
    .gt('tab_balance', 0)
  if (tErr) throw tErr
  const outstandingTabs = sum(tabRows ?? [], r => r.tab_balance)

  // ── Daily breakdown ──────────────────────────────────────────────────
  const paid = allOrders.filter(o => o.status === 'paid')
  const refunded = allOrders.filter(o => o.status === 'refunded')
  const lastDay = Number(end.slice(8, 10))

  const byDay = {}
  for (let d = 1; d <= lastDay; d++) {
    const date = `${monthISO}-${String(d).padStart(2, '0')}`
    byDay[date] = {
      date, cash: 0, card: 0, total: 0, refunds: 0,
      cashback: 0, prizeWins: 0,
      openingFloat: null, actualCash: null, expectedCash: null, variance: null,
    }
  }
  const dayOf = (ts) => byDay[String(ts).slice(0, 10)]

  for (const o of paid) {
    const day = dayOf(o.created_at)
    if (!day) continue
    const amt = Number(o.total_amount ?? 0)
    if (o.payment_method === 'cash') { day.cash += amt; day.total += amt }
    else if (o.payment_method === 'card') { day.card += amt; day.total += amt }
    // tab orders: IOUs, not takings
  }
  for (const o of refunded) {
    const day = dayOf(o.created_at)
    if (day) day.refunds += Number(o.total_amount ?? 0)
  }
  for (const r of cashbackRows ?? []) {
    const day = dayOf(r.created_at)
    if (day) day.cashback += Number(r.amount ?? 0)
  }
  for (const r of prizeRows ?? []) {
    const day = dayOf(r.created_at)
    if (day) day.prizeWins += Number(r.amount ?? 0)
  }

  // Cash reconciliation per closed day, mirroring the Z report:
  // expected = float + cash sales − cashback − prize wins paid from the till
  for (const z of zReports ?? []) {
    const day = byDay[z.report_date]
    if (!day) continue
    day.openingFloat = Number(z.opening_float ?? 0)
    if (z.actual_cash !== null && z.actual_cash !== undefined) {
      day.actualCash = Number(z.actual_cash)
      day.expectedCash = day.openingFloat + day.cash - day.cashback - day.prizeWins
      day.variance = day.actualCash - day.expectedCash
    }
  }

  const daily = Object.values(byDay)

  // ── Month totals ─────────────────────────────────────────────────────
  const cashTotal = sum(daily, d => d.cash)
  const cardTotal = sum(daily, d => d.card)
  const refundsTotal = sum(daily, d => d.refunds)
  const revenue = cashTotal + cardTotal
  const closedDays = daily.filter(d => d.variance !== null)

  const wastageRows = (waste ?? []).filter(r => r.type === 'wastage')
  const staffRows = (waste ?? []).filter(r => r.type === 'staff_drink')
  const retailValue = rows => sum(rows, r => Number(r.quantity ?? 0) * Number(r.products?.standard_price ?? 0))

  const totals = {
    revenue,
    cash: cashTotal,
    card: cardTotal,
    transactionCount: paid.filter(o => o.payment_method !== 'tab').length,
    refunds: refundsTotal,
    netRevenue: revenue - refundsTotal,
    wastage: retailValue(wastageRows),
    staffDrinks: retailValue(staffRows),
    cashback: sum(daily, d => d.cashback),
    prizeWins: sum(daily, d => d.prizeWins),
    variance: sum(closedDays, d => d.variance),
    closedDayCount: closedDays.length,
  }

  // ── Top products (product movement across all orders in the month) ───
  // Joined server-side on the parent order's created_at — a month has
  // thousands of order ids, far too many to pass as an .in() filter.
  const items = await fetchAll(() => supabase
    .from('order_items')
    .select('product_id, quantity, unit_price, products(name), orders!inner(created_at)')
    .gte('orders.created_at', from)
    .lte('orders.created_at', to))
  const map = {}
  for (const it of items) {
    const key = it.product_id
    if (!map[key]) map[key] = { name: it.products?.name ?? 'Unknown', qty: 0, revenue: 0 }
    map[key].qty += Number(it.quantity ?? 0)
    map[key].revenue += Number(it.quantity ?? 0) * Number(it.unit_price ?? 0)
  }
  const topProducts = Object.values(map).sort((a, b) => b.revenue - a.revenue)

  return { month: monthISO, start, end, daily, totals, topProducts, outstandingTabs }
}

const money = n => Number(n ?? 0).toFixed(2)

export function toCsv(data) {
  const lines = []
  lines.push(`Fairmile Club — Monthly Report,${monthLabel(data.month)}`)
  lines.push('')

  lines.push('Daily takings (cash basis — tab orders excluded; settlements included)')
  lines.push('Date,Cash,Card,Total,Refunds,Cashback,Prize wins,Opening float,Actual cash,Expected cash,Variance')
  for (const d of data.daily) {
    lines.push([
      d.date, money(d.cash), money(d.card), money(d.total), money(d.refunds),
      money(d.cashback), money(d.prizeWins),
      d.openingFloat === null ? '' : money(d.openingFloat),
      d.actualCash === null ? '' : money(d.actualCash),
      d.expectedCash === null ? '' : money(d.expectedCash),
      d.variance === null ? '' : money(d.variance),
    ].join(','))
  }
  lines.push('')

  const t = data.totals
  lines.push('Month totals')
  lines.push(`Revenue (cash + card),${money(t.revenue)}`)
  lines.push(`Cash,${money(t.cash)}`)
  lines.push(`Card,${money(t.card)}`)
  lines.push(`Transactions,${t.transactionCount}`)
  lines.push(`Refunds,${money(t.refunds)}`)
  lines.push(`Net revenue,${money(t.netRevenue)}`)
  lines.push(`Wastage (retail value),${money(t.wastage)}`)
  lines.push(`Staff drinks (retail value),${money(t.staffDrinks)}`)
  lines.push(`Cashback paid out,${money(t.cashback)}`)
  lines.push(`Prize wins paid out,${money(t.prizeWins)}`)
  lines.push(`Cash variance (${t.closedDayCount} closed days),${money(t.variance)}`)
  lines.push(`Outstanding tabs (as of report generation),${money(data.outstandingTabs)}`)
  lines.push('')

  lines.push('Product sales (by revenue)')
  lines.push('Product,Qty,Revenue')
  for (const p of data.topProducts) {
    lines.push(`${String(p.name).replaceAll(',', ' ')},${p.qty},${money(p.revenue)}`)
  }

  return lines.join('\n')
}
