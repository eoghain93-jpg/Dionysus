import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: CORS_HEADERS },
    )
  }

  let body: { member_id?: string; pin?: string; mode?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const { member_id, pin, mode = 'verify' } = body

  if (!member_id || !pin) {
    return new Response(
      JSON.stringify({ error: 'member_id and pin are required' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  // PIN must be exactly 4 digits
  if (!/^\d{4}$/.test(pin)) {
    return new Response(
      JSON.stringify({ error: 'PIN must be exactly 4 digits' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- SET MODE ---
  if (mode === 'set') {
    const hash = await bcrypt.hash(pin)
    const { error } = await supabase
      .from('members')
      .update({ pin_hash: hash })
      .eq('id', member_id)
      .eq('membership_tier', 'staff')

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: CORS_HEADERS },
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // --- VERIFY MODE (default) ---
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('id, name, pin_hash, membership_tier')
    .eq('id', member_id)
    .single()

  if (fetchError || !member) {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // Only staff members can log in
  if (member.membership_tier !== 'staff') {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // No PIN set yet
  if (!member.pin_hash) {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  const valid = await bcrypt.compare(pin, member.pin_hash)

  if (valid) {
    return new Response(
      JSON.stringify({ valid: true, member: { id: member.id, name: member.name } }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  return new Response(
    JSON.stringify({ valid: false }),
    { status: 200, headers: CORS_HEADERS },
  )
})
