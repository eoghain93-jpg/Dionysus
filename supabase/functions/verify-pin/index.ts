import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs'

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Brute-force protection: a 4-digit PIN has 10,000 combinations — without
// limiting, an open endpoint is crackable in minutes. 5 failed attempts
// locks the member's PIN for 15 minutes; success resets the counter.
// Both oracles are covered: verify mode AND set mode's current_pin check.
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

type LockState =
  | { locked: true; retryAfterSeconds: number }
  | { locked: false; failedCount: number }

async function getLockState(supabase: SupabaseClient, member_id: string): Promise<LockState> {
  const { data } = await supabase
    .from('pin_attempts')
    .select('failed_count, locked_until')
    .eq('member_id', member_id)
    .maybeSingle()

  if (data?.locked_until) {
    const remainingMs = new Date(data.locked_until).getTime() - Date.now()
    if (remainingMs > 0) {
      return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
    }
    // Lock expired — fresh window
    return { locked: false, failedCount: 0 }
  }
  return { locked: false, failedCount: data?.failed_count ?? 0 }
}

// Records a failed attempt; returns whether this failure tripped the lock.
async function recordFailure(
  supabase: SupabaseClient,
  member_id: string,
  previousFailedCount: number,
): Promise<{ nowLocked: boolean; retryAfterSeconds: number }> {
  const newCount = previousFailedCount + 1
  const nowLocked = newCount >= MAX_FAILED_ATTEMPTS
  await supabase.from('pin_attempts').upsert({
    member_id,
    // counter resets when the lock engages; the lock itself gates retries
    failed_count: nowLocked ? 0 : newCount,
    locked_until: nowLocked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
    updated_at: new Date().toISOString(),
  })
  return { nowLocked, retryAfterSeconds: LOCK_MINUTES * 60 }
}

async function resetAttempts(supabase: SupabaseClient, member_id: string) {
  await supabase.from('pin_attempts').delete().eq('member_id', member_id)
}

function lockedResponse(retryAfterSeconds: number, status = 200) {
  return new Response(
    JSON.stringify({ valid: false, reason: 'locked', retryAfterSeconds }),
    { status, headers: CORS_HEADERS },
  )
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

  let body: { member_id?: string; pin?: string; mode?: string; current_pin?: string }
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- SET MODE ---
  if (mode === 'set') {
    // Fetch current record first so we can enforce bootstrap protection:
    // unauthenticated callers may only set a PIN when none exists yet.
    const { data: existing } = await supabase
      .from('members')
      .select('pin_hash, membership_tier')
      .eq('id', member_id)
      .single()

    // Only staff-tier members can have PINs
    if (!existing || existing.membership_tier !== 'staff') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: CORS_HEADERS },
      )
    }

    // If a PIN already exists, require the current PIN to be supplied as
    // `current_pin`. That check is a brute-force oracle just like verify
    // mode, so it shares the same lockout.
    if (existing.pin_hash) {
      const lockState = await getLockState(supabase, member_id)
      if (lockState.locked) {
        return lockedResponse(lockState.retryAfterSeconds, 403)
      }

      const { current_pin } = body
      if (!current_pin) {
        return new Response(
          JSON.stringify({ error: 'current_pin required to change an existing PIN' }),
          { status: 403, headers: CORS_HEADERS },
        )
      }
      const currentValid = bcrypt.compareSync(current_pin, existing.pin_hash)
      if (!currentValid) {
        const { nowLocked, retryAfterSeconds } = await recordFailure(
          supabase, member_id, lockState.failedCount,
        )
        if (nowLocked) return lockedResponse(retryAfterSeconds, 403)
        return new Response(
          JSON.stringify({ error: 'Incorrect current PIN' }),
          { status: 403, headers: CORS_HEADERS },
        )
      }
      await resetAttempts(supabase, member_id)
    }

    const hash = bcrypt.hashSync(pin, 10)
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

  // No PIN set yet — tell the client so it can offer first-time setup
  if (!member.pin_hash) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'no_pin' }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // Locked? Don't even compare — a locked PIN gives no oracle.
  const lockState = await getLockState(supabase, member_id)
  if (lockState.locked) {
    return lockedResponse(lockState.retryAfterSeconds)
  }

  const valid = bcrypt.compareSync(pin, member.pin_hash)

  if (valid) {
    await resetAttempts(supabase, member_id)
    return new Response(
      JSON.stringify({ valid: true, member: { id: member.id, name: member.name } }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  const { nowLocked, retryAfterSeconds } = await recordFailure(
    supabase, member_id, lockState.failedCount,
  )
  if (nowLocked) {
    return lockedResponse(retryAfterSeconds)
  }

  return new Response(
    JSON.stringify({
      valid: false,
      attemptsRemaining: MAX_FAILED_ATTEMPTS - (lockState.failedCount + 1),
    }),
    { status: 200, headers: CORS_HEADERS },
  )
})
