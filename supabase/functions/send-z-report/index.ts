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
  cardSales?: number
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
  closedBy?: string | null
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
    `Card Received:     ${fmt(t.cardSales ?? 0)}`,
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
    ...(body.closedBy ? [`Closed by: ${body.closedBy}`] : []),
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
    lines.push('', `WEEK SUMMARY (${w.weekStart} → ${w.weekEnd})`, '-'.repeat(56))
    lines.push(
      `${'Day'.padEnd(16)} ${'Cash'.padStart(11)} ${'Card'.padStart(11)} ${'Total'.padStart(11)}`
    )
    lines.push('-'.repeat(56))
    for (const d of w.daily) {
      const dayName = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      lines.push(
        `${dayName.padEnd(16)} ${fmt(d.cash).padStart(11)} ${fmt(d.card).padStart(11)} ${fmt(d.total).padStart(11)}`
      )
    }
    const weekCash = w.daily.reduce((s, d) => s + d.cash, 0)
    const weekCard = w.daily.reduce((s, d) => s + d.card, 0)
    lines.push('-'.repeat(56))
    lines.push(
      `${'TOTAL'.padEnd(16)} ${fmt(weekCash).padStart(11)} ${fmt(weekCard).padStart(11)} ${fmt(w.weekRevenue).padStart(11)}`
    )
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

  const resendKey = getEnv('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  // Recipient list resolution:
  //   1. recipientOverride (one-off resends, validation)
  //   2. z_report_recipients table (active=true rows)
  //   3. MANAGER_EMAIL env (defensive fallback if the table is empty)
  let recipients: string[] = []
  if (body.recipientOverride) {
    recipients = body.recipientOverride.split(',').map(e => e.trim()).filter(Boolean)
  } else {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    if (supabaseUrl && serviceKey) {
      try {
        const r = await fetchFn(
          `${supabaseUrl}/rest/v1/z_report_recipients?active=eq.true&select=email`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        )
        if (r.ok) {
          const rows = await r.json() as Array<{ email: string }>
          recipients = rows.map(row => row.email).filter(Boolean)
        }
      } catch {
        // fall through to MANAGER_EMAIL fallback
      }
    }
    if (recipients.length === 0) {
      const fallback = getEnv('MANAGER_EMAIL')
      if (fallback) recipients = fallback.split(',').map(e => e.trim()).filter(Boolean)
    }
  }
  if (recipients.length === 0) return json({ error: 'no recipients configured' }, 500)

  const emailText = buildEmailText(body)

  const resendRes = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'epos@fairmile.club',
      to: recipients,
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
