// send-stocktake
//
// Emails a stocktake report (CSV attachment) to the same recipient list used
// by the Z report (z_report_recipients table). Used by the Stocktake page
// to deliver a generated report to whoever is doing the independent count.
//
// Request body:
//   csv         — the full CSV body as a string
//   startDate   — YYYY-MM-DD
//   endDate     — YYYY-MM-DD
//   recipientOverride? — optional comma-separated list for one-off sends
//                        (so a single user can email just themselves)
//
// Env: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MANAGER_EMAIL

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface StocktakeBody {
  csv?: string
  startDate?: string
  endDate?: string
  recipientOverride?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: StocktakeBody
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.csv) return json({ error: 'csv required' }, 400)
  if (!body.startDate || !body.endDate) return json({ error: 'startDate and endDate required' }, 400)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  // Same recipient resolution as send-z-report:
  //   1. recipientOverride
  //   2. z_report_recipients table (active=true)
  //   3. MANAGER_EMAIL fallback
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

  const filename = `stocktake-${body.startDate}-to-${body.endDate}.csv`
  const csvBytes = new TextEncoder().encode(body.csv)
  const csvBase64 = encodeBase64(csvBytes)

  const text = [
    `Stocktake report attached.`,
    ``,
    `Period: ${body.startDate} to ${body.endDate}`,
    ``,
    `Activity columns (Sold / Wastage / Staff drinks) are accurate.`,
    `The "System stock now" column reflects manual stock adjustments only —`,
    `sales don't auto-decrement stock yet, so treat that figure as a starting`,
    `reference rather than the live count.`,
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
      subject: `Stocktake report — ${body.startDate} to ${body.endDate}`,
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
