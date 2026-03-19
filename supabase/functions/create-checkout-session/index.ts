import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id, name, tab_balance')
    .eq('auth_user_id', user.id)
    .single()

  if (memberError || !member) {
    return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404 })
  }

  if (member.tab_balance <= 0) {
    return new Response(JSON.stringify({ error: 'No outstanding tab balance' }), { status: 400 })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
  const memberAppUrl = Deno.env.get('MEMBER_APP_URL')!

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'gbp',
        product_data: { name: `Tab payment — ${member.name}` },
        unit_amount: Math.round(member.tab_balance * 100),
      },
      quantity: 1,
    }],
    metadata: { member_id: member.id },
    success_url: `${memberAppUrl}/tab?payment=success`,
    cancel_url: `${memberAppUrl}/tab?payment=cancelled`,
  })

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
