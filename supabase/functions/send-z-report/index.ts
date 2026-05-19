import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SalesSummary {
  totalRevenue: number
  transactionCount: number
  cashTotal: number
  cardTotal: number
  refundsTotal: number
  netRevenue: number
}

interface TopProduct {
  name: string
  qty: number
  revenue: number
}

interface TillReconciliation {
  openingFloat: number
  cashSales: number
  cashbackTotal: number
  prizeWinsTotal: number
  expectedInTill: number
  actualCash: number
  variance: number
}

interface CashReconciliation {
  openingFloat: number
  till1OpeningFloat?: number
  till2OpeningFloat?: number
  cashSales: number
  cashbackTotal?: number
  prizeWinsTotal?: number
  expectedInTill: number
  actualCash: number
  variance: number
  perTill?: { till1: TillReconciliation; till2: TillReconciliation }
}

interface WastageItem {
  name: string
  quantity: number
  value: number
}

interface StaffDrinkSummary {
  name: string
  items: number
  value: number
}

interface WeekSummary {
  weekStart: string
  weekEnd: string
  daily: Array<{ date: string; cash: number; card: number; total: number }>
  weekRevenue: number
  topProducts: TopProduct[]
  wastageTotal: number
  staffDrinksTotal: number
  previousWeekRevenue: number
  weekOnWeekDelta: number | null
}

interface ZReportBody {
  reportDate: string
  salesSummary: SalesSummary
  topProducts: TopProduct[]
  cashReconciliation: CashReconciliation
  wastage: WastageItem[]
  staffDrinks: StaffDrinkSummary[]
  weekToDateRevenue?: number
  outstandingTabs?: number
  weekSummary?: WeekSummary | null
  recipientOverride?: string  // optional comma-separated list to send only to these addresses (validation/resends)
}

function fmt(n: number): string {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-£${abs}` : `£${abs}`
}

function buildPerTillReconciliationLines(c: CashReconciliation): string[] {
  const perTill = c.perTill!
  const tillBlock = (title: string, t: TillReconciliation) => [
    title,
    '-'.repeat(40),
    `Opening Float:     ${fmt(t.openingFloat)}`,
    `Cash Received:     ${fmt(t.cashSales)}`,
    `Cashback Given:    ${t.cashbackTotal > 0 ? `-${fmt(t.cashbackTotal)}` : '—'}`,
    `Prize Wins:        ${t.prizeWinsTotal > 0 ? `-${fmt(t.prizeWinsTotal)}` : '—'}`,
    `Expected in Till:  ${fmt(t.expectedInTill)}`,
    `Actual Cash:       ${fmt(t.actualCash)}`,
    `Variance:          ${fmt(t.variance)}`,
    '',
  ]
  return [
    ...tillBlock('CASH RECONCILIATION — TILL 1', perTill.till1),
    ...tillBlock('CASH RECONCILIATION — TILL 2', perTill.till2),
    'CASH RECONCILIATION — COMBINED',
    '-'.repeat(40),
    `Total Expected:    ${fmt(c.expectedInTill)}`,
    `Total Actual Cash: ${fmt(c.actualCash)}`,
    `Total Variance:    ${fmt(c.variance)}`,
  ]
}

function buildEmailText(body: ZReportBody): string {
  const { reportDate, salesSummary: s, topProducts, cashReconciliation: c } = body
  const cashback   = c.cashbackTotal   ?? 0
  const prizeWins  = c.prizeWinsTotal  ?? 0
  const wkToDate   = body.weekToDateRevenue ?? 0
  const outstanding = body.outstandingTabs ?? 0
  const lines: string[] = [
    `Z Report — ${reportDate}`,
    '='.repeat(40),
    '',
    'SALES SUMMARY',
    '-'.repeat(40),
    `Total Revenue:     ${fmt(s.totalRevenue)}`,
    `Transactions:      ${s.transactionCount}`,
    `Cash:              ${fmt(s.cashTotal)}`,
    `Card:              ${fmt(s.cardTotal)}`,
    `Refunds:           ${fmt(-s.refundsTotal)}`,
    `Net Revenue:       ${fmt(s.netRevenue)}`,
    `Week to Date:      ${fmt(wkToDate)}`,
    `Outstanding Tabs:  ${fmt(outstanding)}`,
    '',
    'TOP PRODUCTS',
    '-'.repeat(40),
    ...topProducts.map((p, i) =>
      `${String(i + 1).padStart(2, ' ')}. ${p.name.padEnd(20)} x${p.qty}  ${fmt(p.revenue)}`
    ),
    '',
    ...(c.perTill
      ? buildPerTillReconciliationLines(c)
      : [
          'CASH RECONCILIATION',
          '-'.repeat(40),
          `Opening Float:     ${fmt(c.openingFloat)}`,
          `Cash Received:     ${fmt(c.cashSales)}`,
          `Cashback Given:    ${cashback > 0 ? `-${fmt(cashback)}` : '—'}`,
          `Prize Wins:        ${prizeWins > 0 ? `-${fmt(prizeWins)}` : '—'}`,
          `Expected in Till:  ${fmt(c.expectedInTill)}`,
          `Actual Cash:       ${fmt(c.actualCash)}`,
          `Variance:          ${fmt(c.variance)}`,
        ]),
  ]

  if (body.weekSummary) {
    const w = body.weekSummary
    lines.push('', `WEEK SUMMARY (${w.weekStart} → ${w.weekEnd})`, '-'.repeat(40))
    for (const d of w.daily) {
      const dayName = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      lines.push(`${dayName.padEnd(20)} ${fmt(d.total)}`)
    }
    lines.push('-'.repeat(40))
    lines.push(`Week Total:        ${fmt(w.weekRevenue)}`)
    lines.push(`Last Week:         ${fmt(w.previousWeekRevenue)}`)
    if (w.weekOnWeekDelta != null) {
      const sign = w.weekOnWeekDelta >= 0 ? '+' : ''
      lines.push(`Change:            ${sign}${w.weekOnWeekDelta.toFixed(1)}%`)
    }
    lines.push(`Wastage (week):    ${fmt(w.wastageTotal)}`)
    lines.push(`Staff Drinks:      ${fmt(w.staffDrinksTotal)}`)
    if (w.topProducts.length > 0) {
      lines.push('', 'Top sellers (week)')
      for (let i = 0; i < w.topProducts.length; i++) {
        const p = w.topProducts[i]
        lines.push(`${String(i + 1).padStart(2, ' ')}. ${p.name.padEnd(20)} x${p.qty}  ${fmt(p.revenue)}`)
      }
    }
  }

  if (body.wastage?.length > 0) {
    lines.push('', 'WASTAGE', '-'.repeat(40))
    body.wastage.forEach(w =>
      lines.push(`${w.name.padEnd(20)} ×${w.quantity}  ${fmt(w.value)}`)
    )
  }

  if (body.staffDrinks?.length > 0) {
    lines.push('', 'STAFF DRINKS', '-'.repeat(40))
    body.staffDrinks.forEach(s =>
      lines.push(`${s.name.padEnd(20)} ${s.items} item${s.items !== 1 ? 's' : ''}  ${fmt(s.value)}`)
    )
  }

  lines.push('')
  return lines.join('\n')
}

export async function handler(
  req: Request,
  getEnv: (key: string) => string | undefined = Deno.env.get.bind(Deno.env),
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  let body: ZReportBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.reportDate) return json({ error: 'reportDate required' }, 400)
  if (!body.salesSummary) return json({ error: 'salesSummary required' }, 400)
  if (!body.topProducts) return json({ error: 'topProducts required' }, 400)
  if (!body.cashReconciliation) return json({ error: 'cashReconciliation required' }, 400)

  const managerEmail = getEnv('MANAGER_EMAIL')
  if (!managerEmail) return json({ error: 'MANAGER_EMAIL not configured' }, 500)

  const resendKey = getEnv('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  const emailText = buildEmailText(body)

  const resendRes = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'epos@fairmile.club',
      to: (body.recipientOverride ?? managerEmail).split(',').map(e => e.trim()).filter(Boolean),
      subject: `Z Report — ${body.reportDate}`,
      text: emailText,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.json().catch(() => ({}))
    return json({ error: err.message ?? 'Failed to send email' }, 500)
  }

  return json({ sent: true })
}

serve((req) => handler(req))
