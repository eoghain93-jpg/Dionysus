// generate-google-wallet-pass
//
// Builds a Google Wallet "Save to Wallet" URL for a member.
// We sign a JWT (RS256) with the service account's private key that contains
// both the GenericClass template and the per-member GenericObject. Google
// registers them on first save and subsequent saves are dedupe'd by id.
//
// Request:  POST { member_id: string }
// Response: { saveUrl: string } — frontend redirects/opens this URL
//
// Env:
//   GOOGLE_WALLET_ISSUER_ID — 16+ digit numeric ID from pay.google.com
//   GOOGLE_WALLET_SERVICE_ACCOUNT_JSON — full JSON file content (string)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — for member lookup

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create as createJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PUB_NAME = 'Fairmile Sports & Social Club'
const LOGO_URL = 'https://club-epos.vercel.app/fairmile-logo.png'
const CLASS_SUFFIX = 'fairmile-membership-v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { member_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.member_id) return json({ error: 'member_id required' }, 400)

  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')
  const saJson  = Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON')
  if (!issuerId || !saJson) return json({ error: 'Wallet env not configured' }, 500)

  let serviceAccount: { client_email: string; private_key: string }
  try {
    serviceAccount = JSON.parse(saJson)
  } catch {
    return json({ error: 'Service account JSON is invalid' }, 500)
  }

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
  const classId  = `${issuerId}.${CLASS_SUFFIX}`
  const objectId = `${issuerId}.${member.id}`

  const genericClass = {
    id: classId,
    classTemplateInfo: { cardTemplateOverride: {} },
    hexBackgroundColor: '#0F172A',
    logo: { sourceUri: { uri: LOGO_URL } },
  }

  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle:  { defaultValue: { language: 'en-GB', value: PUB_NAME } },
    header:     { defaultValue: { language: 'en-GB', value: member.name } },
    subheader:  { defaultValue: { language: 'en-GB', value: `${tierLabel} · ${member.membership_number}` } },
    barcode: { type: 'QR_CODE', value: member.membership_number },
    hexBackgroundColor: '#0F172A',
    logo: { sourceUri: { uri: LOGO_URL } },
  }

  // Sign the save-to-wallet JWT with the service account key (RS256)
  const privateKey = await importRsaPrivateKey(serviceAccount.private_key)

  const claims = {
    iss: serviceAccount.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: getNumericDate(0),
    payload: {
      genericClasses:  [genericClass],
      genericObjects:  [genericObject],
    },
  }

  const jwt = await createJwt({ alg: 'RS256', typ: 'JWT' }, claims, privateKey)
  return json({ saveUrl: `https://pay.google.com/gp/v/save/${jwt}` })
})

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and base64-decode the body to DER bytes
  const cleaned = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))

  return await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
