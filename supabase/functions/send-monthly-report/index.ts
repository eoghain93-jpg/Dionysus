// send-monthly-report
//
// Emails the monthly accountant report (CSV attachment). Two modes:
//
//   Till mode (body.csv present) — the till builds the CSV client-side
//   (src/lib/monthlyReport.js) and this function just emails it. Any
//   valid JWT (the anon key the till ships with) may call this.
//
//   Build mode (no body.csv) — the function builds the CSV itself from
//   the database (report.ts). This is what the pg_cron job calls on the
//   1st of each month. Because it reads real financials and can email
//   them anywhere via recipientOverride, build mode requires either the
//   service-role key as bearer or the CRON_SECRET as an x-cron-secret
//   header. `month` defaults to the month just gone. `dryRun: true`
//   returns the CSV without emailing anything.
//
// Recipient resolution (both modes):
//   1. recipientOverride (comma-separated, for one-off sends)
//   2. monthly_report_recipients table (active=true) — the accountant list
//   3. z_report_recipients table (active=true) — legacy fallback
//   4. MANAGER_EMAIL fallback
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MANAGER_EMAIL,
//      CRON_SECRET (shared with the pg_cron job via Vault)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchMonthlyReportData, monthLabel, previousMonthISO, toCsv } from './report.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface MonthlyReportBody {
  csv?: string
  month?: string
  recipientOverride?: string
  dryRun?: boolean
  // Marks a re-send that replaces an earlier report for the same month:
  // "(updated/corrected)" is appended to the subject and a note added
  // to the body so the accountant knows which version to keep.
  corrected?: boolean
}

async function resolveRecipients(supabaseUrl: string, serviceKey: string, table: string): Promise<string[]> {
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/${table}?active=eq.true&select=email`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!r.ok) return []
    const rows = await r.json() as Array<{ email: string }>
    return rows.map(row => row.email).filter(Boolean)
  } catch {
    return []
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: MonthlyReportBody
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (body.month && !/^\d{4}-\d{2}$/.test(body.month)) return json({ error: 'month must be YYYY-MM' }, 400)
  if (body.csv && !body.month) return json({ error: 'month (YYYY-MM) required' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  let csv = body.csv
  let month = body.month
  if (!csv) {
    // Build mode: reads real financials with the service role, so the
    // anon key that ships in the till bundle is not enough. The caller
    // must present either the service-role key as bearer, or the
    // CRON_SECRET shared with the pg_cron job (which authenticates the
    // gateway with the anon key and passes the secret as a header).
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const cronSecret = Deno.env.get('CRON_SECRET')
    const hasServiceRole = Boolean(serviceKey) && bearer === serviceKey
    const hasCronSecret = Boolean(cronSecret) && req.headers.get('x-cron-secret') === cronSecret
    if (!hasServiceRole && !hasCronSecret) {
      return json({ error: 'build mode requires service role or cron secret' }, 403)
    }
    month = month ?? previousMonthISO()
    try {
      const supabase = createClient(supabaseUrl, serviceKey)
      const data = await fetchMonthlyReportData(supabase, month)
      csv = toCsv(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return json({ error: `report build failed: ${msg}` }, 502)
    }
    if (body.dryRun) return json({ dryRun: true, month, csv })
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  let recipients: string[] = []
  if (body.recipientOverride) {
    recipients = body.recipientOverride.split(',').map(e => e.trim()).filter(Boolean)
  } else if (supabaseUrl && serviceKey) {
    recipients = await resolveRecipients(supabaseUrl, serviceKey, 'monthly_report_recipients')
    if (recipients.length === 0) {
      recipients = await resolveRecipients(supabaseUrl, serviceKey, 'z_report_recipients')
    }
  }
  if (recipients.length === 0) {
    const fallback = Deno.env.get('MANAGER_EMAIL')
    if (fallback) recipients = fallback.split(',').map(e => e.trim()).filter(Boolean)
  }
  if (recipients.length === 0) return json({ error: 'no recipients configured' }, 500)

  const label = monthLabel(month!)
  const filename = `monthly-report-${month}.csv`
  const csvBase64 = encodeBase64(new TextEncoder().encode(csv))

  const text = [
    `Monthly report for ${label} attached.`,
    ...(body.corrected ? [
      ``,
      `This updated report replaces the ${label} version sent previously —`,
      `please use this one.`,
    ] : []),
    ``,
    `Figures are cash-basis, consistent with the daily Z reports:`,
    `revenue is cash + card actually received (tab settlements included);`,
    `tab orders themselves are excluded, with what's owed shown as`,
    `Outstanding Tabs. Wastage and staff drinks are valued at retail.`,
    `Each day runs to 6am, so late sessions count toward the night`,
    `they started.`,
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
      subject: `Monthly report — ${label}${body.corrected ? ' (updated/corrected)' : ''}`,
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
