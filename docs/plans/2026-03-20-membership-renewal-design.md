# Membership Renewal Design

## Goal

A public self-service join/renewal flow. Prospective members fill in their details, pay £50 via Stripe, and are automatically added to the Supabase members table and sent a magic link to activate their Fairmile account.

## Context

- No existing member database — everyone signs up fresh
- Currently staff-entered; goal is full automation
- Capture: name, email, phone
- No expiry tracking in this iteration

---

## Data Model

**Migration:** add `phone text` column to `members` table. No other schema changes.

---

## UI: Join Page (`/join` in Fairmile)

Public route — no auth required. Three states:

- **Form** — name, email, phone inputs + "Join for £50" button. On submit, calls `create-membership-checkout` edge function, redirects to returned Stripe Checkout URL.
- **Success** (`?status=success`) — "Payment received — check your email for your membership link."
- **Cancelled** (`?status=cancelled`) — returns user to the form.

**LoginPage** gets a "Not a member yet? Join for £50 →" link pointing to `/join`.

---

## Edge Functions

### New: `create-membership-checkout`

- Public (no auth)
- Accepts `{ name, email, phone }`
- Creates Stripe Checkout session: £50, `type: 'membership'` in metadata, success/cancel URLs pointing back to `/join`
- Returns `{ url }` — client redirects to it

### Updated: `stripe-webhook`

Differentiates payment type via Stripe session metadata:

- `type: 'tab_topup'` → existing logic unchanged
- `type: 'membership'` → insert new member row (name, email, phone, active: true, auto-generated membership_number using `M` + zero-padded count), then call `supabase.auth.admin.inviteUserByEmail(email)` to send magic link

---

## Routing

| Route | Auth required | Notes |
|-------|--------------|-------|
| `/join` | No | New public page |
| `/login` | No | Add link to `/join` |
| `/auth/callback` | No | Unchanged |
| `/*` | Yes | Unchanged |
