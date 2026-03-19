import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

serve(async (req) => {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, Deno.env.get('STRIPE_WEBHOOK_SECRET')!)
  } catch {
    return new Response('Webhook signature verification failed', { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('OK', { status: 200 })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const member_id = session.metadata?.member_id
  const amount = (session.amount_total ?? 0) / 100

  if (!member_id || amount <= 0) {
    return new Response('Invalid session metadata', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error: insertError } = await supabase.from('tab_payments').insert({
    member_id,
    amount,
    stripe_payment_intent_id: session.payment_intent as string,
  })
  if (insertError) {
    console.error('Failed to insert tab_payment:', insertError)
    return new Response('DB error', { status: 500 })
  }

  const { error: balanceError } = await supabase.rpc('decrement_tab_balance', {
    p_member_id: member_id,
    p_amount: amount,
  })
  if (balanceError) {
    console.error('Failed to decrement tab balance:', balanceError)
    return new Response('DB error', { status: 500 })
  }

  return new Response('OK', { status: 200 })
})
