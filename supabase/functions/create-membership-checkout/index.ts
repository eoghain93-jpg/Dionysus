import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14'

// NOTE: This endpoint is intentionally public (no auth). It has no rate limiting — this is a known
// limitation. Stripe does not charge for abandoned sessions, but volume abuse is possible. Consider
// adding platform-level throttling via Supabase dashboard before public launch.

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let name: string, email: string, phone: string
  try {
    const body = await req.json()
    name = body.name?.trim()
    email = body.email?.trim()
    phone = body.phone?.trim()
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!name || !email || !phone) {
    return new Response(JSON.stringify({ error: 'name, email and phone are required' }), {
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

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })

  let session
  try {
    session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: 'Fairmile Sports & Social Club — Annual Membership' },
          unit_amount: 5000,
        },
        quantity: 1,
      }],
      metadata: { type: 'membership', name, email, phone },
      success_url: `${memberAppUrl}/join?status=success`,
      cancel_url: `${memberAppUrl}/join?status=cancelled`,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Payment provider error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
