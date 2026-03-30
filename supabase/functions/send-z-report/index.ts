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
  tabTotal: number
  refundsTotal: number
  netRevenue: number
}

interface TopProduct {
  name: string
  qty: number
  revenue: number
}

interface CashReconciliation {
  openingFloat: number
  cashSales: number
  expectedInTill: number
  actualCash: number
  variance: number
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

interface ZReportBody {
  reportDate: string
  salesSummary: SalesSummary
  topProducts: TopProduct[]
  cashReconciliation: CashReconciliation
  wastage: WastageItem[]
  staffDrinks: StaffDrinkSummary[]
}

function fmt(n: number): string {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-£${abs}` : `£${abs}`
}

function buildEmailText(body: ZReportBody): string {
  const { reportDate, salesSummary: s, topProducts, cashReconciliation: c } = body
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
    `Tab:               ${fmt(s.tabTotal)}`,
    `Refunds:           ${fmt(-s.refundsTotal)}`,
    `Net Revenue:       ${fmt(s.netRevenue)}`,
    '',
    'TOP PRODUCTS',
    '-'.repeat(40),
    ...topProducts.map((p, i) =>
      `${String(i + 1).padStart(2, ' ')}. ${p.name.padEnd(20)} x${p.qty}  ${fmt(p.revenue)}`
    ),
    '',
    'CASH RECONCILIATION',
    '-'.repeat(40),
    `Opening Float:     ${fmt(c.openingFloat)}`,
    `Cash Sales:        ${fmt(c.cashSales)}`,
    `Expected in Till:  ${fmt(c.expectedInTill)}`,
    `Actual Cash:       ${fmt(c.actualCash)}`,
    `Variance:          ${fmt(c.variance)}`,
  ]

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
      to: managerEmail.split(',').map(e => e.trim()),
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
