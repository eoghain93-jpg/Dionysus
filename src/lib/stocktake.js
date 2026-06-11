import { supabase } from './supabase'
import { fetchAllPages } from './fetchAllPages'

// Stocktake report builder.
//
// For an external stocktaker, the useful figures are activity over a period
// per product: how many sold, how much wasted, how much went to staff drinks.
// They compare those numbers against their own physical count to find
// shrinkage.
//
// Note: stock_quantity on the products row is currently NOT decremented on
// sale (see project roadmap). It only reflects wastage/staff-drink/spillage
// adjustments. Activity columns are accurate; the "System stock now" column
// should be treated as a starting reference, not gospel.

/**
 * @param {string} startDate  YYYY-MM-DD inclusive
 * @param {string} endDate    YYYY-MM-DD inclusive
 */
export async function fetchStocktakeData(startDate, endDate) {
  const from = `${startDate}T00:00:00`
  const to   = `${endDate}T23:59:59`

  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, name, category, unit, standard_price, member_price, stock_quantity, par_level, active')
    .eq('active', true)
    .order('category')
    .order('name')
  if (pErr) throw pErr

  // Paid orders in the period. Paged — a 30-day window is 3,000+ orders,
  // well past the 1000-row PostgREST cap, which previously truncated the
  // sold figures silently.
  const orders = await fetchAllPages(() => supabase
    .from('orders')
    .select('id')
    .eq('status', 'paid')
    .gte('created_at', from)
    .lte('created_at', to))

  const orderIds = orders.map(o => o.id)

  // Order items batched to stay under URL length limits
  const items = []
  const BATCH = 200
  for (let i = 0; i < orderIds.length; i += BATCH) {
    const batch = orderIds.slice(i, i + BATCH)
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, quantity, unit_price, staff_credit_for')
      .in('order_id', batch)
    if (error) throw error
    items.push(...(data ?? []))
  }

  const soldQty = new Map()
  const soldRev = new Map()
  for (const it of items) {
    // "One for staff" lines moved no stock at sale time — the pint leaves
    // the cellar at redemption, which lands in the movement buckets below
    // as a staff_credit_redemption. Counting the line here too would
    // double-count the unit in totalOut.
    if (it.staff_credit_for) continue
    const q = Number(it.quantity) || 0
    const r = q * (Number(it.unit_price) || 0)
    soldQty.set(it.product_id, (soldQty.get(it.product_id) ?? 0) + q)
    soldRev.set(it.product_id, (soldRev.get(it.product_id) ?? 0) + r)
  }

  const moves = await fetchAllPages(() => supabase
    .from('stock_movements')
    .select('product_id, quantity, type')
    .gte('created_at', from)
    .lte('created_at', to))

  const wasteQty = new Map()
  const sdQty = new Map()
  const otherQty = new Map()
  const otherTypes = new Set()
  for (const m of moves ?? []) {
    const q = Number(m.quantity) || 0
    if (m.type === 'wastage') {
      wasteQty.set(m.product_id, (wasteQty.get(m.product_id) ?? 0) + q)
    } else if (m.type === 'staff_drink') {
      sdQty.set(m.product_id, (sdQty.get(m.product_id) ?? 0) + q)
    } else {
      otherQty.set(m.product_id, (otherQty.get(m.product_id) ?? 0) + q)
      otherTypes.add(m.type)
    }
  }

  const rows = (products ?? []).map(p => {
    const sQty = soldQty.get(p.id) ?? 0
    const sRev = soldRev.get(p.id) ?? 0
    const wQty = wasteQty.get(p.id) ?? 0
    const dQty = sdQty.get(p.id) ?? 0
    const oQty = otherQty.get(p.id) ?? 0
    const price = Number(p.standard_price) || 0
    return {
      product_id: p.id,
      category: p.category,
      name: p.name,
      unit: p.unit ?? '',
      standardPrice: price,
      memberPrice: Number(p.member_price) || 0,
      soldQty: sQty,
      soldRevenue: sRev,
      wastageQty: wQty,
      wastageValue: wQty * price,
      staffDrinkQty: dQty,
      staffDrinkValue: dQty * price,
      otherMovementQty: oQty,
      totalOut: sQty + wQty + dQty + oQty,
      systemStock: Number(p.stock_quantity) || 0,
      parLevel: Number(p.par_level) || 0,
    }
  })

  const totals = rows.reduce((t, r) => ({
    salesRevenue: t.salesRevenue + r.soldRevenue,
    wastageValue: t.wastageValue + r.wastageValue,
    staffDrinkValue: t.staffDrinkValue + r.staffDrinkValue,
  }), { salesRevenue: 0, wastageValue: 0, staffDrinkValue: 0 })

  return {
    startDate,
    endDate,
    rows,
    totals,
    otherMovementTypes: [...otherTypes].sort(),
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function n(v) {
  if (!v) return ''
  return Number(v).toString()
}

function money(v) {
  if (!v) return ''
  return Number(v).toFixed(2)
}

export function toCsv(data) {
  const header = [
    'Category', 'Product', 'Unit',
    'Standard Price', 'Member Price',
    'Sold (qty)', 'Sold (£ retail)',
    'Wastage (qty)', 'Wastage (£ retail)',
    'Staff drinks (qty)', 'Staff drinks (£ retail)',
    'Other movement (qty)',
    'Total out (qty)',
    'System stock now', 'Par level',
    'Physical count', 'Variance (qty)', 'Variance (£)', 'Notes',
  ]
  const lines = [header.map(csvEscape).join(',')]
  for (const r of data.rows) {
    lines.push([
      r.category, r.name, r.unit,
      money(r.standardPrice), money(r.memberPrice),
      n(r.soldQty), money(r.soldRevenue),
      n(r.wastageQty), money(r.wastageValue),
      n(r.staffDrinkQty), money(r.staffDrinkValue),
      n(r.otherMovementQty),
      n(r.totalOut),
      n(r.systemStock), n(r.parLevel),
      '', '', '', '',
    ].map(csvEscape).join(','))
  }
  lines.push('')
  lines.push(`# Period: ${data.startDate} to ${data.endDate}`)
  lines.push(`# Sales (retail): £${data.totals.salesRevenue.toFixed(2)}`)
  lines.push(`# Wastage (retail): £${data.totals.wastageValue.toFixed(2)}`)
  lines.push(`# Staff drinks (retail): £${data.totals.staffDrinkValue.toFixed(2)}`)
  if (data.otherMovementTypes.length > 0) {
    lines.push(`# Other movement types: ${data.otherMovementTypes.join(', ')}`)
  }
  return lines.join('\n')
}
