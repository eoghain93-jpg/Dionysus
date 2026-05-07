// send-wallet-pass-email
//
// For a single member: generates both an Apple .pkpass and a Google Wallet
// save URL, then emails them via Resend. The .pkpass is attached so iPhone
// users tap once to add to Wallet; the Google save URL is rendered as a
// button for Android users.
//
// Request:  POST { member_id: string }
// Response: { sent: true } on success
//
// Designed to be called in a loop from an admin script for bulk seeding,
// but also works for one-off resends.
//
// Env (all already configured):
//   RESEND_API_KEY, WALLETWALLET_API_KEY, GOOGLE_WALLET_ISSUER_ID,
//   GOOGLE_WALLET_SERVICE_ACCOUNT_JSON, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create as createJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PUB_NAME = 'Fairmile Sports & Social Club'
const LOGO_URL = 'https://club-epos.vercel.app/fairmile-logo.png'
const FROM_ADDRESS = 'epos@fairmile.club'
const CLASS_SUFFIX = 'fairmile-membership-v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { member_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.member_id) return json({ error: 'member_id required' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: member, error: memberErr } = await supabase
    .from('members')
    .select('id, name, email, membership_number, membership_tier')
    .eq('id', body.member_id)
    .single()

  if (memberErr || !member) return json({ error: 'Member not found' }, 404)
  if (!member.email)        return json({ error: 'Member has no email on file' }, 400)

  const tierLabel = member.membership_tier === 'staff' ? 'Staff' : 'Member'

  // --- Apple .pkpass via walletwallet.dev ---
  const wwKey = Deno.env.get('WALLETWALLET_API_KEY')
  if (!wwKey) return json({ error: 'WALLETWALLET_API_KEY not configured' }, 500)

  const passPayload = {
    barcodeValue: member.membership_number,
    barcodeFormat: 'QR',
    logoText: PUB_NAME,
    backgroundColor: 'rgb(15, 23, 42)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(148, 163, 184)',
    primaryFields:   [{ key: 'name',   label: 'Member', value: member.name }],
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

  const wwRes = await fetch('https://api.walletwallet.dev/api/pkpass', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${wwKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(passPayload),
  })

  if (!wwRes.ok) {
    const text = await wwRes.text().catch(() => '')
    return json({ error: `walletwallet returned ${wwRes.status}: ${text}` }, 502)
  }
  const pkpassBuffer = new Uint8Array(await wwRes.arrayBuffer())
  const pkpassBase64 = encodeBase64(pkpassBuffer)

  // --- Google Wallet save URL (RS256 JWT) ---
  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')
  const saJson   = Deno.env.get('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON')
  if (!issuerId || !saJson) return json({ error: 'Google Wallet env not configured' }, 500)

  const sa = JSON.parse(saJson) as { client_email: string; private_key: string }
  const classId  = `${issuerId}.${CLASS_SUFFIX}`
  const objectId = `${issuerId}.${member.id}`

  const claims = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: getNumericDate(0),
    payload: {
      genericClasses: [{
        id: classId,
        classTemplateInfo: { cardTemplateOverride: {} },
        hexBackgroundColor: '#0F172A',
        logo: { sourceUri: { uri: LOGO_URL } },
      }],
      genericObjects: [{
        id: objectId,
        classId,
        state: 'ACTIVE',
        cardTitle: { defaultValue: { language: 'en-GB', value: PUB_NAME } },
        header:    { defaultValue: { language: 'en-GB', value: member.name } },
        subheader: { defaultValue: { language: 'en-GB', value: `${tierLabel} · ${member.membership_number}` } },
        barcode: { type: 'QR_CODE', value: member.membership_number },
        hexBackgroundColor: '#0F172A',
        logo: { sourceUri: { uri: LOGO_URL } },
      }],
    },
  }

  const privateKey = await importRsaPrivateKey(sa.private_key)
  const jwt = await createJwt({ alg: 'RS256', typ: 'JWT' }, claims, privateKey)
  const googleSaveUrl = `https://pay.google.com/gp/v/save/${jwt}`

  // --- Email via Resend ---
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  const html = renderEmailHtml({
    memberName: member.name,
    membershipNumber: member.membership_number,
    googleSaveUrl,
  })
  const text = renderEmailText({
    memberName: member.name,
    membershipNumber: member.membership_number,
    googleSaveUrl,
  })

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [member.email],
      subject: `Your ${PUB_NAME} membership card`,
      html,
      text,
      attachments: [{
        filename: `fairmile-${member.membership_number}.pkpass`,
        content: pkpassBase64,
        content_type: 'application/vnd.apple.pkpass',
      }],
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text().catch(() => '')
    return json({ error: `Resend returned ${resendRes.status}: ${errText}` }, 502)
  }

  return json({ sent: true, to: member.email })
})

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
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

interface EmailParams {
  memberName: string
  membershipNumber: string
  googleSaveUrl: string
}

function renderEmailHtml({ memberName, membershipNumber, googleSaveUrl }: EmailParams): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; background: #0F172A; color: #FFFFFF; margin: 0; padding: 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto;">
    <tr>
      <td style="padding: 24px 0; text-align: center;">
        <h1 style="color: #FFFFFF; font-size: 22px; margin: 0 0 8px 0;">Your membership card is ready</h1>
        <p style="color: #94A3B8; font-size: 14px; margin: 0;">${PUB_NAME}</p>
      </td>
    </tr>
    <tr>
      <td style="background: #1E293B; border-radius: 16px; padding: 24px; color: #FFFFFF;">
        <p style="margin: 0 0 12px 0;">Hi ${memberName},</p>
        <p style="margin: 0 0 16px 0; color: #CBD5E1; font-size: 14px;">
          Your digital membership card is ready. Add it to your phone wallet for quick access at the bar — just show the QR code to be identified.
        </p>
        <p style="margin: 0 0 24px 0; color: #94A3B8; font-size: 13px;">
          Membership number: <strong style="color: #FFFFFF; font-family: monospace;">${membershipNumber}</strong>
        </p>

        <h3 style="color: #FFFFFF; font-size: 14px; margin: 24px 0 8px 0;">📱 iPhone</h3>
        <p style="color: #CBD5E1; font-size: 13px; margin: 0 0 16px 0;">
          Open this email on your iPhone, then tap the attached <strong>.pkpass</strong> file. Apple Wallet will prompt you to add it.
        </p>

        <h3 style="color: #FFFFFF; font-size: 14px; margin: 24px 0 8px 0;">🤖 Android</h3>
        <p style="color: #CBD5E1; font-size: 13px; margin: 0 0 16px 0;">
          Open this email on your Android phone, then tap the button below.
        </p>
        <p style="text-align: center; margin: 16px 0;">
          <a href="${googleSaveUrl}" style="background: #FFFFFF; color: #1F2937; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; display: inline-block;">
            Add to Google Wallet
          </a>
        </p>

        <p style="color: #64748B; font-size: 12px; margin: 24px 0 0 0; padding-top: 16px; border-top: 1px solid #334155;">
          No phone wallet? No problem — just give your name or membership number to staff at the bar.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px 0; text-align: center; color: #64748B; font-size: 12px;">
        ${PUB_NAME}
      </td>
    </tr>
  </table>
</body>
</html>`
}

function renderEmailText({ memberName, membershipNumber, googleSaveUrl }: EmailParams): string {
  return `Hi ${memberName},

Your ${PUB_NAME} digital membership card is ready.

Membership number: ${membershipNumber}

iPhone — open this email on your iPhone, tap the attached .pkpass file, and Apple Wallet will prompt you to add it.

Android — open this email on your Android phone and tap this link:
${googleSaveUrl}

No phone wallet? Just give your name or membership number to staff at the bar.

— ${PUB_NAME}`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
