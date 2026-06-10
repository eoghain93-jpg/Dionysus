// send-monthly-report
//
// Emails the monthly accountant report (CSV attachment). Recipient
// resolution mirrors send-stocktake / send-z-report:
//   1. recipientOverride (comma-separated, for one-off sends — e.g. the
//      accountant's address before it's added to the recipients table)
//   2. z_report_recipients table (active=true)
//   3. MANAGER_EMAIL fallback
//
// Request body:
//   csv                — the full CSV body as a string
//   month              — YYYY-MM
//   recipientOverride? — optional comma-separated list
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MANAGER_EMAIL

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface MonthlyReportBody {
  csv?: string
  month?: string
  recipientOverride?: string
}

function monthLabel(monthISO: string): string {
  const [year, month] = monthISO.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: MonthlyReportBody
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.csv) return json({ error: 'csv required' }, 400)
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month)) return json({ error: 'month (YYYY-MM) required' }, 400)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  let recipients: string[] = []
  if (body.recipientOverride) {
    recipients = body.recipientOverride.split(',').map(e => e.trim()).filter(Boolean)
  } else {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (supabaseUrl && serviceKey) {
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/z_report_recipients?active=eq.true&select=email`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        )
        if (r.ok) {
          const rows = await r.json() as Array<{ email: string }>
          recipients = rows.map(row => row.email).filter(Boolean)
        }
      } catch { /* fall through to MANAGER_EMAIL */ }
    }
    if (recipients.length === 0) {
      const fallback = Deno.env.get('MANAGER_EMAIL')
      if (fallback) recipients = fallback.split(',').map(e => e.trim()).filter(Boolean)
    }
  }
  if (recipients.length === 0) return json({ error: 'no recipients configured' }, 500)

  const label = monthLabel(body.month)
  const filename = `monthly-report-${body.month}.csv`
  const csvBase64 = encodeBase64(new TextEncoder().encode(body.csv))

  const text = [
    `Monthly report for ${label} attached.`,
    ``,
    `Figures are cash-basis, consistent with the daily Z reports:`,
    `revenue is cash + card actually received (tab settlements included);`,
    `tab orders themselves are excluded, with what's owed shown as`,
    `Outstanding Tabs. Wastage and staff drinks are valued at retail.`,
    ``,
    `— Fairmile Sports & Social Club`,
  ].join('\n')

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'epos@fairmile.club',
      to: recipients,
      subject: `Monthly report — ${label}`,
      text,
      attachments: [{
        filename,
        content: csvBase64,
        content_type: 'text/csv',
      }],
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.text().catch(() => '')
    return json({ error: `Resend ${resendRes.status}: ${err}` }, 502)
  }
  return json({ sent: true, recipients: recipients.length })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
