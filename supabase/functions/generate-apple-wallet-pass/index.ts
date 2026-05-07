// generate-apple-wallet-pass
//
// Generates a signed .pkpass file for a member by proxying through
// walletwallet.dev. They handle the Apple Pass cert chain and signing,
// we just provide the per-member content.
//
// Request:  POST { member_id: string }
// Response: binary .pkpass (Content-Type: application/vnd.apple.pkpass)
//
// Env:
//   WALLETWALLET_API_KEY — bearer token for walletwallet.dev
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — for member lookup

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PUB_NAME = 'Fairmile Sports & Social Club'
const LOGO_URL = 'https://club-epos.vercel.app/fairmile-logo.png'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: { member_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.member_id) return json({ error: 'member_id required' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: member, error } = await supabase
    .from('members')
    .select('id, name, membership_number, membership_tier')
    .eq('id', body.member_id)
    .single()

  if (error || !member) return json({ error: 'Member not found' }, 404)

  const tierLabel = member.membership_tier === 'staff' ? 'Staff' : 'Member'

  const passPayload = {
    barcodeValue: member.membership_number,
    barcodeFormat: 'QR',
    logoText: PUB_NAME,
    backgroundColor: 'rgb(15, 23, 42)',     // slate-900
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(148, 163, 184)',       // slate-400
    primaryFields: [
      { key: 'name', label: 'Member', value: member.name },
    ],
    secondaryFields: [
      { key: 'number', label: 'Number', value: member.membership_number },
      { key: 'tier',   label: 'Tier',   value: tierLabel },
    ],
    backFields: [
      { key: 'about', label: 'About', value: 'Show this card at the bar to be identified.' },
      { key: 'pub',   label: 'Club',  value: PUB_NAME },
    ],
    logoUrl: LOGO_URL,
  }

  const apiKey = Deno.env.get('WALLETWALLET_API_KEY')
  if (!apiKey) return json({ error: 'WALLETWALLET_API_KEY not configured' }, 500)

  const wwRes = await fetch('https://api.walletwallet.dev/api/pkpass', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(passPayload),
  })

  if (!wwRes.ok) {
    const text = await wwRes.text().catch(() => '')
    return json({ error: `walletwallet returned ${wwRes.status}: ${text}` }, 502)
  }

  // Stream the .pkpass binary back to the caller
  const passBuffer = await wwRes.arrayBuffer()
  return new Response(passBuffer, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="fairmile-${member.membership_number}.pkpass"`,
    },
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
