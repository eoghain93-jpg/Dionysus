import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let member_id: string, email: string
  try {
    const body = await req.json()
    member_id = body.member_id
    email = body.email
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!member_id || !email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'member_id and valid email required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const memberAppUrl = Deno.env.get('MEMBER_APP_URL')
  if (!memberAppUrl) {
    return new Response(JSON.stringify({ error: 'MEMBER_APP_URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: authData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: memberAppUrl + '/auth/callback' }
  )

  if (inviteError) {
    return new Response(JSON.stringify({ error: inviteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { error: updateError } = await supabase
    .from('members')
    .update({ auth_user_id: authData.user.id })
    .eq('id', member_id)

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
