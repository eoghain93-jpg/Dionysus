// send-morning-check
//
// Daily sanity check on yesterday's close, so Close Day problems surface
// the next morning instead of weeks later in the monthly accountant
// report. The pg_cron job (migration 20260727150000) calls this at
// 07:30 UTC — inside the club's never-trades 6–11am window, 90 minutes
// after the trading-day cutoff — and it checks the trading day that
// ended at the most recent 06:00 cutoff (06:00→06:00 UTC, see
// src/lib/tradingDay.js).
//
// Checks:
//   1. Orders exist but no z_reports row       → day was never closed
//   2. z_reports row with actual_cash 0/null
//      while cash was taken                    → closed without a cash count
//      (this is what happened on 2026-05-08 and 2026-05-24)
//   3. |variance| over the threshold (£50)     → large variance, with figures
//
// If any check fires, the manager list (z_report_recipients, active=true)
// is emailed via Resend. All quiet → no email, 200 with issues: [].
//
// This reads real financials and can email them anywhere via
// recipientOverride, so — like send-monthly-report build mode — the
// caller must present the service-role key as bearer or the CRON_SECRET
// as an x-cron-secret header (the cron job authenticates the gateway
// with the anon key and passes the secret).
//
// Body (all optional):
//   date: 'YYYY-MM-DD'        trading day to check (default: yesterday's)
//   varianceThreshold: 50     alert threshold in £ for check 3
//   dryRun: true              return findings without emailing
//   recipientOverride: 'a@b'  comma-separated, for one-off tests
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      MANAGER_EMAIL, CRON_SECRET (shared with the pg_cron job via Vault)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_VARIANCE_THRESHOLD_GBP = 50

interface MorningCheckBody {
  date?: string
  varianceThreshold?: number
  dryRun?: boolean
  recipientOverride?: string
}

interface Issue {
  title: string
  lines: string[]
}

// ── Trading day (mirrors src/lib/tradingDay.js) ────────────────────────
// The reporting day runs 06:00 UTC to 06:00 UTC so late sessions count
// toward the night they started. Keep in sync with the JS original and
// the copy in send-monthly-report/report.ts.
export const TRADING_DAY_CUTOFF_HOURS = 6

const CUTOFF = `T${String(TRADING_DAY_CUTOFF_HOURS).padStart(2, '0')}:00:00`

function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The trading day that ended at the most recent 06:00 cutoff. */
export function previousTradingDayISO(now = new Date()): string {
  const d = new Date(now)
  d.setUTCHours(d.getUTCHours() - TRADING_DAY_CUTOFF_HOURS)
  return addDaysISO(d.toISOString().slice(0, 10), -1)
}

/** created_at bounds for one trading day — `to` EXCLUSIVE (.gte/.lt). */
function tradingDayRange(dateISO: string) {
  return { from: `${dateISO}${CUTOFF}`, to: `${addDaysISO(dateISO, 1)}${CUTOFF}` }
}

// ── Data ───────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>
const sum = (arr: Row[], pick: (r: Row) => unknown) =>
  arr.reduce((s, r) => s + Number(pick(r) ?? 0), 0)

// PostgREST caps responses at 1000 rows; a big match night can exceed it,
// so page like send-monthly-report/report.ts (ordered for stable pages).
const PAGE_SIZE = 1000

// deno-lint-ignore no-explicit-any
async function fetchAll(buildQuery: () => any): Promise<Row[]> {
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

function fmt(n: number): string {
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-£${abs}` : `£${abs}`
}

export async function runChecks(
  supabase: SupabaseClient,
  date: string,
  varianceThreshold: number,
): Promise<Issue[]> {
  const { from, to } = tradingDayRange(date)

  const orders = await fetchAll(() => supabase
    .from('orders')
    .select('id, total_amount, payment_method, status')
    .gte('created_at', from)
    .lt('created_at', to))

  const { data: zRows, error: zErr } = await supabase
    .from('z_reports')
    .select('report_date, opening_float, actual_cash')
    .eq('report_date', date)
  if (zErr) throw zErr
  const z = zRows?.[0] ?? null

  const { data: cashbackRows, error: cbErr } = await supabase
    .from('cashback_transactions')
    .select('amount')
    .gte('created_at', from)
    .lt('created_at', to)
  if (cbErr) throw cbErr

  const { data: prizeRows, error: pwErr } = await supabase
    .from('prize_wins')
    .select('amount')
    .gte('created_at', from)
    .lt('created_at', to)
  if (pwErr) throw pwErr

  const paid = orders.filter(o => o.status === 'paid')
  const cash = sum(paid.filter(o => o.payment_method === 'cash'), o => o.total_amount)
  const card = sum(paid.filter(o => o.payment_method === 'card'), o => o.total_amount)
  const cashback = sum(cashbackRows ?? [], r => r.amount)
  const prizeWins = sum(prizeRows ?? [], r => r.amount)

  const issues: Issue[] = []

  // 1. Trading happened but the day was never closed.
  if (orders.length > 0 && !z) {
    issues.push({
      title: 'Day was never closed',
      lines: [
        `${orders.length} order${orders.length === 1 ? ' was' : 's were'} rung up (${fmt(cash)} cash + ${fmt(card)} card taken),`,
        `but Close Day was never pressed. No Z report went out and the`,
        `drawer was never counted against takings. Close the day from the`,
        `till (Reports → Z Report) as soon as possible so the figures`,
        `reach the daily and monthly reports.`,
      ],
    })
    return issues
  }

  if (!z) return issues // quiet day, nothing traded, nothing to close

  // The system convention (see migration 20260727130000) is that
  // actual_cash 0 or null means "never counted" — a real count always
  // includes the float, so a genuine count is never £0.
  const float = Number(z.opening_float ?? 0)
  const expected = float + cash - cashback - prizeWins
  const hasCount = z.actual_cash != null && Number(z.actual_cash) !== 0

  // 2. Closed, cash was taken, but the drawer was never counted.
  if (!hasCount && cash > 0) {
    issues.push({
      title: 'Closed without a cash count',
      lines: [
        `${fmt(cash)} cash was taken, but the day was closed with Actual`,
        `Cash ${z.actual_cash == null ? 'left empty' : 'still at £0.00'} — the drawer was never counted. Expected in`,
        `the drawer: ${fmt(expected)} (float ${fmt(float)} + cash ${fmt(cash)} − cashback`,
        `${fmt(cashback)} − prize wins ${fmt(prizeWins)}). If the drawer hasn't been`,
        `disturbed, count it this morning and correct the figure.`,
      ],
    })
  }

  // 3. Counted, but the variance is over the alert threshold.
  if (hasCount) {
    const actual = Number(z.actual_cash)
    const variance = actual - expected
    if (Math.abs(variance) > varianceThreshold) {
      issues.push({
        title: `Large cash variance (${fmt(variance)})`,
        lines: [
          `Expected in drawer: ${fmt(expected)} (float ${fmt(float)} + cash ${fmt(cash)}`,
          `− cashback ${fmt(cashback)} − prize wins ${fmt(prizeWins)})`,
          `Actual cash counted: ${fmt(actual)}`,
          `Variance: ${fmt(variance)} — over the ${fmt(varianceThreshold)} alert threshold.`,
          `Worth a recount and a check for unlogged cashback, prize wins`,
          `or refunds before the figure hardens into the monthly report.`,
        ],
      })
    }
  }

  return issues
}

export function buildEmailText(date: string, issues: Issue[]): string {
  const lines: string[] = [
    `Morning check — ${date}`,
    '='.repeat(40),
  ]
  issues.forEach((issue, i) => {
    lines.push('', `${i + 1}. ${issue.title.toUpperCase()}`, '-'.repeat(40), ...issue.lines)
  })
  lines.push(
    '',
    `This is the automated morning check on yesterday's trading day`,
    `(06:00–06:00 UTC). It only emails when something needs a look.`,
    '',
    '— Fairmile Sports & Social Club',
    '',
  )
  return lines.join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: MorningCheckBody
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400)
  }
  if (body.varianceThreshold != null
      && (typeof body.varianceThreshold !== 'number' || !(body.varianceThreshold > 0))) {
    return json({ error: 'varianceThreshold must be a positive number' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  // Same gate as send-monthly-report build mode: the anon key that ships
  // in the till bundle is not enough to read financials.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const cronSecret = Deno.env.get('CRON_SECRET')
  const hasServiceRole = Boolean(serviceKey) && bearer === serviceKey
  const hasCronSecret = Boolean(cronSecret) && req.headers.get('x-cron-secret') === cronSecret
  if (!hasServiceRole && !hasCronSecret) {
    return json({ error: 'requires service role or cron secret' }, 403)
  }

  const date = body.date ?? previousTradingDayISO()
  const threshold = body.varianceThreshold ?? DEFAULT_VARIANCE_THRESHOLD_GBP

  let issues: Issue[]
  try {
    const supabase = createClient(supabaseUrl, serviceKey)
    issues = await runChecks(supabase, date, threshold)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ error: `morning check failed: ${msg}` }, 502)
  }

  if (body.dryRun) return json({ dryRun: true, date, issues })
  if (issues.length === 0) return json({ date, issues: [], sent: false })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  // Managers get this — the same list as the daily Z report, NOT the
  // accountant list (monthly_report_recipients).
  let recipients: string[] = []
  if (body.recipientOverride) {
    recipients = body.recipientOverride.split(',').map(e => e.trim()).filter(Boolean)
  } else {
    try {
      const r = await fetch(
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
    if (recipients.length === 0) {
      const fallback = Deno.env.get('MANAGER_EMAIL')
      if (fallback) recipients = fallback.split(',').map(e => e.trim()).filter(Boolean)
    }
  }
  if (recipients.length === 0) return json({ error: 'no recipients configured' }, 500)

  const subject = issues.length === 1
    ? `Morning check — ${date}: ${issues[0].title}`
    : `Morning check — ${date}: ${issues.length} issues with yesterday's close`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'epos@fairmile.club',
      to: recipients,
      subject,
      text: buildEmailText(date, issues),
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.text().catch(() => '')
    return json({ error: `Resend ${resendRes.status}: ${err}` }, 502)
  }
  return json({ date, issues: issues.map(i => i.title), sent: true, recipients: recipients.length })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
