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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (session.metadata?.type === 'membership') {
    const { name, email, phone } = session.metadata

    // Idempotency: check if this email was already processed (Stripe may retry webhooks)
    const { data: existing } = await supabase
      .from('members')
      .select('id, auth_user_id')
      .eq('email', email)
      .maybeSingle()

    if (existing?.auth_user_id) {
      // Already fully processed
      return new Response('OK', { status: 200 })
    }

    let memberId: string

    if (existing) {
      // Member row exists but invite/link not yet completed — skip insert
      memberId = existing.id
    } else {
      const { count } = await supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
      const membership_number = `M${String((count ?? 0) + 1).padStart(4, '0')}`

      const { data: member, error: insertError } = await supabase
        .from('members')
        .insert({ name, email, phone, active: true, membership_number, tab_balance: 0 })
        .select('id')
        .single()

      if (insertError || !member) {
        console.error('Failed to create member:', insertError)
        return new Response('DB error', { status: 500 })
      }

      memberId = member.id
    }

    const memberAppUrl = Deno.env.get('MEMBER_APP_URL') ?? ''
    const { data: authData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: memberAppUrl + '/auth/callback' }
    )

    if (inviteError) {
      console.error('Failed to invite member:', inviteError)
      // Member row was created — don't fail the webhook. Invite can be resent.
      return new Response('OK', { status: 200 })
    }

    const { error: updateError } = await supabase
      .from('members')
      .update({ auth_user_id: authData.user.id })
      .eq('id', memberId)

    if (updateError) {
      console.error('Failed to link auth_user_id to member:', memberId, updateError)
    }

    return new Response('OK', { status: 200 })
  }

  // Tab top-up (existing logic)
  const member_id = session.metadata?.member_id
  const amount = (session.amount_total ?? 0) / 100

  if (!member_id || amount <= 0) {
    return new Response('Invalid session metadata', { status: 400 })
  }

  const { error: paymentError } = await supabase.rpc('record_tab_payment', {
    p_member_id: member_id,
    p_amount: amount,
    p_stripe_payment_intent_id: session.payment_intent as string,
  })
  if (paymentError) {
    console.error('Failed to record tab payment:', paymentError)
    return new Response('DB error', { status: 500 })
  }

  return new Response('OK', { status: 200 })
})
