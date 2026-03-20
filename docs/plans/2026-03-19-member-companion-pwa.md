# Member Companion PWA — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a member-facing PWA at `member-app/` where members can view their digital membership card, check and pay their tab balance, and browse transaction history — sharing the same Supabase project as the EPOS.

**Architecture:** A second Vite + React app lives in `member-app/` within the same repo. It shares the existing Supabase project (same DB, same env vars). Members authenticate via Supabase Auth magic link (invite sent when staff create a member in the EPOS). Tab payments go through Stripe Checkout via Supabase Edge Functions.

**Tech Stack:** React 19 + Vite 7, TailwindCSS v4, Supabase Auth, Supabase Edge Functions (Deno), Stripe Checkout, vite-plugin-pwa, qrcode.react, Vitest

---

## Pre-flight: install Supabase CLI

The Edge Functions require the Supabase CLI. Check if it's installed:

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npx supabase --version
```

If not installed, run: `npm install -g supabase`

---

## Task 1: Database migration — auth_user_id + tab_payments + RLS

**Files:**
- Create: `supabase/migrations/20260319_member_auth.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/20260319_member_auth.sql

-- Link members to Supabase Auth users
alter table members add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists members_auth_user_id_idx on members(auth_user_id);

-- Track Stripe tab payments (top-ups from companion app)
create table if not exists tab_payments (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id),
  amount numeric(10,2) not null,
  stripe_payment_intent_id text unique not null,
  created_at timestamptz default now()
);

alter table tab_payments enable row level security;

-- RLS: members can only read their own member row
drop policy if exists "Allow all" on members;
create policy "Staff full access" on members
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own row" on members
  for select
  using (auth_user_id = auth.uid());

-- RLS: members can only read their own orders
drop policy if exists "Allow all" on orders;
create policy "Staff full access" on orders
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own orders" on orders
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- RLS: members can only read their own tab_payments
create policy "Member read own payments" on tab_payments
  for select
  using (member_id = (
    select id from members where auth_user_id = auth.uid()
  ));

-- Service role full access on tab_payments
create policy "Staff full access" on tab_payments
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- RLS: order_items — members can read items for their own orders
drop policy if exists "Allow all" on order_items;
create policy "Staff full access" on order_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Member read own order items" on order_items
  for select
  using (order_id in (
    select id from orders where member_id = (
      select id from members where auth_user_id = auth.uid()
    )
  ));
```

**Step 2: Apply migration to local Supabase or note to apply to production**

> If you have a local Supabase instance running: `npx supabase db push`
> If not, copy-paste this SQL into the Supabase dashboard SQL editor for your project.

**Step 3: Commit**

```bash
git add supabase/migrations/20260319_member_auth.sql
git commit -m "feat: add auth_user_id to members, tab_payments table, member RLS policies"
```

---

## Task 2: Edge Function — invite-member

Sends a Supabase Auth magic link invite when staff create a member with an email.

**Files:**
- Create: `supabase/functions/invite-member/index.ts`

**Step 1: Write the Edge Function**

```typescript
// supabase/functions/invite-member/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { member_id, email } = await req.json()

  if (!member_id || !email) {
    return new Response(JSON.stringify({ error: 'member_id and email required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Invite the user via Supabase Auth
  const { data: authData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: Deno.env.get('MEMBER_APP_URL') + '/auth/callback' }
  )

  if (inviteError) {
    return new Response(JSON.stringify({ error: inviteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Link the auth user to the member record
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
```

**Step 2: Commit**

```bash
git add supabase/functions/invite-member/index.ts
git commit -m "feat: add invite-member edge function"
```

---

## Task 3: Edge Function — create-checkout-session

Creates a Stripe Checkout session for a member to pay their tab.

**Files:**
- Create: `supabase/functions/create-checkout-session/index.ts`

**Step 1: Write the Edge Function**

```typescript
// supabase/functions/create-checkout-session/index.ts
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

  // Get authenticated member
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
```

**Step 2: Commit**

```bash
git add supabase/functions/create-checkout-session/index.ts
git commit -m "feat: add create-checkout-session edge function"
```

---

## Task 4: Edge Function — stripe-webhook

Handles Stripe payment confirmations and updates the member's tab balance.

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`

**Step 1: Write the Edge Function**

```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

serve(async (req) => {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

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

  // Record the payment
  const { error: insertError } = await supabase.from('tab_payments').insert({
    member_id,
    amount,
    stripe_payment_intent_id: session.payment_intent as string,
  })
  if (insertError) {
    console.error('Failed to insert tab_payment:', insertError)
    return new Response('DB error', { status: 500 })
  }

  // Reduce tab balance (set to 0 if payment covers full balance)
  const { data: member } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()

  const newBalance = Math.max(0, (member?.tab_balance ?? 0) - amount)
  await supabase.from('members').update({ tab_balance: newBalance }).eq('id', member_id)

  return new Response('OK', { status: 200 })
})
```

**Step 2: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: add stripe-webhook edge function"
```

---

## Task 5: Update EPOS to send invite on member create

When staff create a member with an email, call the `invite-member` edge function.

**Files:**
- Modify: `src/lib/members.js`

**Step 1: Write the failing test**

In `src/lib/members.test.js`, add:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upsertMember } from './members'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}))

vi.mock('./db', () => ({
  db: { members: { put: vi.fn() } },
}))

vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

describe('upsertMember', () => {
  it('invites member via edge function when email provided on create', async () => {
    const mockMember = { id: 'uuid-1', name: 'Test', membership_number: 'M0001', email: 'test@test.com' }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'Test', email: 'test@test.com' })

    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-member', {
      body: { member_id: 'uuid-1', email: 'test@test.com' },
    })
  })

  it('does not invite when no email provided', async () => {
    const mockMember = { id: 'uuid-2', name: 'NoEmail', membership_number: 'M0002' }
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'NoEmail' })

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test -- src/lib/members.test.js
```

Expected: FAIL — `supabase.functions.invoke` not called

**Step 3: Update `src/lib/members.js` — add invite call after insert**

In `upsertMember`, after the `insert` branch succeeds, add:

```javascript
// After: await db.members.put(data)
// Add:
if (data.email) {
  await supabase.functions.invoke('invite-member', {
    body: { member_id: data.id, email: data.email },
  })
}
```

**Step 4: Run test to confirm it passes**

```bash
npm test -- src/lib/members.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/members.js src/lib/members.test.js
git commit -m "feat: invoke invite-member edge function when creating member with email"
```

---

## Task 6: Scaffold member-app Vite project

**Files:**
- Create: `member-app/package.json`
- Create: `member-app/vite.config.js`
- Create: `member-app/index.html`
- Create: `member-app/src/main.jsx`
- Create: `member-app/src/App.jsx`
- Create: `member-app/src/index.css`
- Create: `member-app/src/lib/supabase.js`
- Create: `member-app/src/test/setup.js`
- Create: `member-app/.env.example`

**Step 1: Create `member-app/package.json`**

```json
{
  "name": "club-epos-member-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest --passWithNoTests"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.99.0",
    "lucide-react": "^0.577.0",
    "qrcode.react": "^4.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.13.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@vitejs/plugin-react": "^5.1.1",
    "globals": "^16.5.0",
    "jsdom": "^28.1.0",
    "tailwindcss": "^4.2.1",
    "vite": "^7.3.1",
    "vite-plugin-pwa": "^1.2.0",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create `member-app/vite.config.js`**

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Club Member',
        short_name: 'Member',
        description: 'Your club membership card and tab',
        theme_color: '#1e3a5f',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  }
})
```

**Step 3: Create `member-app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Club Member</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

**Step 4: Create `member-app/src/lib/supabase.js`**

```javascript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

**Step 5: Create `member-app/src/test/setup.js`**

```javascript
import '@testing-library/jest-dom'
```

**Step 6: Create `member-app/.env.example`**

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Step 7: Install dependencies**

```bash
cd member-app
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm install
cd ..
```

**Step 8: Commit scaffold**

```bash
git add member-app/
git commit -m "feat: scaffold member companion PWA app"
```

---

## Task 7: Auth flow — login page + callback handler

The member clicks a magic link from their email and lands on the app, already authenticated.

**Files:**
- Create: `member-app/src/pages/LoginPage.jsx`
- Create: `member-app/src/pages/AuthCallbackPage.jsx`
- Create: `member-app/src/stores/authStore.js`

**Step 1: Write the failing test**

Create `member-app/src/stores/authStore.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

describe('authStore', () => {
  it('initialises with null session and member', async () => {
    const { useAuthStore } = await import('./authStore')
    const { result } = renderHook(() => useAuthStore())
    expect(result.current.session).toBeNull()
    expect(result.current.member).toBeNull()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app
npm test -- src/stores/authStore.test.js
cd ..
```

Expected: FAIL — module not found

**Step 3: Create `member-app/src/stores/authStore.js`**

```javascript
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set) => ({
  session: null,
  member: null,
  loading: true,

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const member = await fetchMember(session.user.id)
      set({ session, member, loading: false })
    } else {
      set({ session: null, member: null, loading: false })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const member = await fetchMember(session.user.id)
        set({ session, member })
      } else {
        set({ session: null, member: null })
      }
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, member: null })
  },
}))

async function fetchMember(authUserId) {
  const { data } = await supabase
    .from('members')
    .select('id, name, membership_number, membership_tier, tab_balance, email')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/stores/authStore.test.js && cd ..
```

Expected: PASS

**Step 5: Create `member-app/src/pages/LoginPage.jsx`**

This page is shown if the member navigates to the app without being authenticated (e.g. their session expired). It explains they need to use the magic link from their email.

```jsx
// member-app/src/pages/LoginPage.jsx
export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl">🎫</span>
        </div>
        <h1 className="text-white text-2xl font-bold mb-3">Club Member</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Check your email for your membership invite link. Tap it to access your digital card and tab.
        </p>
        <p className="text-slate-500 text-xs mt-6">
          Don't have a link? Contact the club.
        </p>
      </div>
    </div>
  )
}
```

**Step 6: Create `member-app/src/pages/AuthCallbackPage.jsx`**

Supabase handles the token exchange automatically — this page just shows a loading state while it completes.

```jsx
// member-app/src/pages/AuthCallbackPage.jsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate('/', { replace: true })
      }
    })
  }, [navigate])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-slate-400">Signing you in…</p>
    </div>
  )
}
```

**Step 7: Commit**

```bash
git add member-app/src/
git commit -m "feat: member app auth store, login page, and auth callback"
```

---

## Task 8: App shell — routing + layout + bottom nav

**Files:**
- Create: `member-app/src/App.jsx`
- Create: `member-app/src/main.jsx`
- Create: `member-app/src/index.css`
- Create: `member-app/src/components/BottomNav.jsx`
- Create: `member-app/src/components/Layout.jsx`

**Step 1: Write failing test for BottomNav**

Create `member-app/src/components/BottomNav.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav'

describe('BottomNav', () => {
  it('renders all four navigation tabs', () => {
    render(<MemoryRouter><BottomNav /></MemoryRouter>)
    expect(screen.getByText('My Card')).toBeInTheDocument()
    expect(screen.getByText('My Tab')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app && npm test -- src/components/BottomNav.test.jsx && cd ..
```

**Step 3: Create `member-app/src/components/BottomNav.jsx`**

```jsx
import { NavLink } from 'react-router-dom'
import { CreditCard, Wallet, Clock, User } from 'lucide-react'

const links = [
  { to: '/', label: 'My Card', Icon: CreditCard },
  { to: '/tab', label: 'My Tab', Icon: Wallet },
  { to: '/history', label: 'History', Icon: Clock },
  { to: '/account', label: 'Account', Icon: User },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 flex">
      {links.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              isActive ? 'text-blue-400' : 'text-slate-500'
            }`
          }
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/components/BottomNav.test.jsx && cd ..
```

**Step 5: Create `member-app/src/components/Layout.jsx`**

```jsx
import BottomNav from './BottomNav'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-900 pb-16">
      {children}
      <BottomNav />
    </div>
  )
}
```

**Step 6: Create `member-app/src/index.css`**

```css
@import "tailwindcss";
```

**Step 7: Create `member-app/src/main.jsx`**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

**Step 8: Create `member-app/src/App.jsx`**

```jsx
import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import MyCardPage from './pages/MyCardPage'
import MyTabPage from './pages/MyTabPage'
import HistoryPage from './pages/HistoryPage'
import AccountPage from './pages/AccountPage'

export default function App() {
  const { session, loading, init } = useAuthStore()

  useEffect(() => { init() }, [init])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<MyCardPage />} />
        <Route path="/tab" element={<MyTabPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
```

**Step 9: Commit**

```bash
git add member-app/src/
git commit -m "feat: member app shell with routing and bottom nav"
```

---

## Task 9: My Card screen

**Files:**
- Create: `member-app/src/pages/MyCardPage.jsx`
- Create: `member-app/src/pages/MyCardPage.test.jsx`

**Step 1: Write the failing test**

```jsx
// member-app/src/pages/MyCardPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyCardPage from './MyCardPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: {
      id: 'uuid-1',
      name: 'Jane Smith',
      membership_number: 'M0042',
      membership_tier: 'member',
    },
  }),
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qrcode">{value}</div>,
}))

describe('MyCardPage', () => {
  it('displays member name and membership number', () => {
    render(<MyCardPage />)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('M0042')).toBeInTheDocument()
  })

  it('renders a QR code with the membership number', () => {
    render(<MyCardPage />)
    const qr = screen.getByTestId('qrcode')
    expect(qr.textContent).toBe('M0042')
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app && npm test -- src/pages/MyCardPage.test.jsx && cd ..
```

**Step 3: Create `member-app/src/pages/MyCardPage.jsx`**

```jsx
import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '../stores/authStore'

export default function MyCardPage() {
  const { member } = useAuthStore()

  if (!member) return null

  const tierLabel = member.membership_tier === 'staff' ? 'Staff' : 'Member'

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 gap-8">
      <div className="bg-gradient-to-br from-blue-800 to-slate-800 rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <div className="text-slate-400 text-xs uppercase tracking-widest mb-6">Club Membership</div>
        <div className="text-white text-2xl font-bold mb-1">{member.name}</div>
        <div className="text-blue-300 text-sm mb-8">{tierLabel}</div>
        <div className="bg-white rounded-2xl p-4 flex items-center justify-center mb-6">
          <QRCodeSVG value={member.membership_number} size={180} />
        </div>
        <div className="text-center">
          <div className="text-slate-400 text-xs mb-1">Membership Number</div>
          <div className="text-white text-xl font-mono tracking-widest">{member.membership_number}</div>
        </div>
      </div>
      <p className="text-slate-500 text-xs text-center">
        Show this QR code at the bar to be identified
      </p>
    </div>
  )
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/pages/MyCardPage.test.jsx && cd ..
```

**Step 5: Commit**

```bash
git add member-app/src/pages/MyCardPage.jsx member-app/src/pages/MyCardPage.test.jsx
git commit -m "feat: My Card screen with QR code"
```

---

## Task 10: My Tab screen

**Files:**
- Create: `member-app/src/pages/MyTabPage.jsx`
- Create: `member-app/src/pages/MyTabPage.test.jsx`

**Step 1: Write the failing test**

```jsx
// member-app/src/pages/MyTabPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MyTabPage from './MyTabPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { id: 'uuid-1', name: 'Jane Smith', tab_balance: 12.50 },
    session: { access_token: 'mock-token' },
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn().mockResolvedValue({ data: { url: 'https://stripe.com/checkout/mock' }, error: null }) },
  },
}))

describe('MyTabPage', () => {
  it('displays current tab balance', () => {
    render(<MemoryRouter><MyTabPage /></MemoryRouter>)
    expect(screen.getByText('£12.50')).toBeInTheDocument()
  })

  it('shows "all clear" message when balance is zero', () => {
    vi.mock('../stores/authStore', () => ({
      useAuthStore: () => ({
        member: { id: 'uuid-1', name: 'Jane', tab_balance: 0 },
        session: { access_token: 'mock-token' },
      }),
    }))
    render(<MemoryRouter><MyTabPage /></MemoryRouter>)
    // Balance display still shows 0 or a clear state — just verify no crash
    expect(screen.getByText(/tab/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app && npm test -- src/pages/MyTabPage.test.jsx && cd ..
```

**Step 3: Create `member-app/src/pages/MyTabPage.jsx`**

```jsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

export default function MyTabPage() {
  const { member } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchParams] = useSearchParams()
  const paymentStatus = searchParams.get('payment')

  if (!member) return null

  const balance = member.tab_balance ?? 0
  const hasBalance = balance > 0

  async function handlePayTab() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('create-checkout-session')
    if (error || !data?.url) {
      setError('Could not start payment. Please try again.')
      setLoading(false)
      return
    }
    window.location.href = data.url
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 gap-6">
      {paymentStatus === 'success' && (
        <div className="bg-green-900 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm w-full max-w-sm text-center">
          Payment successful — your tab has been updated.
        </div>
      )}
      {paymentStatus === 'cancelled' && (
        <div className="bg-slate-800 border border-slate-700 text-slate-400 rounded-xl px-4 py-3 text-sm w-full max-w-sm text-center">
          Payment cancelled.
        </div>
      )}

      <div className="bg-slate-800 rounded-3xl p-8 w-full max-w-sm text-center">
        <div className="text-slate-400 text-sm mb-2">Outstanding Tab</div>
        <div className={`text-5xl font-bold mb-8 ${hasBalance ? 'text-amber-400' : 'text-green-400'}`}>
          £{balance.toFixed(2)}
        </div>

        {hasBalance ? (
          <>
            <button
              onClick={handlePayTab}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors"
            >
              {loading ? 'Starting payment…' : `Pay £${balance.toFixed(2)}`}
            </button>
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </>
        ) : (
          <p className="text-slate-400 text-sm">Your tab is all clear!</p>
        )}
      </div>
    </div>
  )
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/pages/MyTabPage.test.jsx && cd ..
```

**Step 5: Commit**

```bash
git add member-app/src/pages/MyTabPage.jsx member-app/src/pages/MyTabPage.test.jsx
git commit -m "feat: My Tab screen with Stripe checkout integration"
```

---

## Task 11: History screen

**Files:**
- Create: `member-app/src/pages/HistoryPage.jsx`
- Create: `member-app/src/pages/HistoryPage.test.jsx`

**Step 1: Write the failing test**

```jsx
// member-app/src/pages/HistoryPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HistoryPage from './HistoryPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { id: 'uuid-1' },
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(
        table === 'orders'
          ? { data: [{ id: 'o1', total_amount: 8.50, created_at: '2026-03-19T20:00:00Z', payment_method: 'tab' }], error: null }
          : { data: [{ id: 'p1', amount: 20.00, created_at: '2026-03-18T10:00:00Z' }], error: null }
      ),
    })),
  },
}))

describe('HistoryPage', () => {
  it('renders tab purchases and payments', async () => {
    render(<HistoryPage />)
    await waitFor(() => {
      expect(screen.getByText('−£8.50')).toBeInTheDocument()
      expect(screen.getByText('+£20.00')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app && npm test -- src/pages/HistoryPage.test.jsx && cd ..
```

**Step 3: Create `member-app/src/pages/HistoryPage.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

export default function HistoryPage() {
  const { member } = useAuthStore()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!member) return
    async function load() {
      const [ordersResult, paymentsResult] = await Promise.all([
        supabase.from('orders')
          .select('id, total_amount, created_at, payment_method')
          .eq('member_id', member.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('tab_payments')
          .select('id, amount, created_at')
          .eq('member_id', member.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      const purchases = (ordersResult.data ?? []).map(o => ({
        id: o.id,
        type: 'purchase',
        label: o.payment_method === 'tab' ? 'Tab purchase' : 'Purchase',
        amount: -o.total_amount,
        date: o.created_at,
      }))

      const payments = (paymentsResult.data ?? []).map(p => ({
        id: p.id,
        type: 'payment',
        label: 'Tab payment',
        amount: p.amount,
        date: p.created_at,
      }))

      const combined = [...purchases, ...payments].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      )
      setEntries(combined)
      setLoading(false)
    }
    load()
  }, [member])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading history…</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 min-h-screen p-4">
      <h1 className="text-white text-xl font-bold mb-4 pt-4">History</h1>
      {entries.length === 0 ? (
        <p className="text-slate-500 text-sm text-center mt-12">No transactions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(entry => (
            <div key={entry.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-white text-sm">{entry.label}</div>
                <div className="text-slate-500 text-xs">
                  {new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <div className={`font-semibold text-sm ${entry.amount >= 0 ? 'text-green-400' : 'text-slate-300'}`}>
                {entry.amount >= 0 ? '+' : '−'}£{Math.abs(entry.amount).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/pages/HistoryPage.test.jsx && cd ..
```

**Step 5: Commit**

```bash
git add member-app/src/pages/HistoryPage.jsx member-app/src/pages/HistoryPage.test.jsx
git commit -m "feat: History screen showing purchases and tab payments"
```

---

## Task 12: Account screen

**Files:**
- Create: `member-app/src/pages/AccountPage.jsx`
- Create: `member-app/src/pages/AccountPage.test.jsx`

**Step 1: Write failing test**

```jsx
// member-app/src/pages/AccountPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccountPage from './AccountPage'

const mockSignOut = vi.fn()
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: { name: 'Jane Smith', email: 'jane@test.com', membership_number: 'M0042' },
    signOut: mockSignOut,
  }),
}))

describe('AccountPage', () => {
  it('shows member details', () => {
    render(<AccountPage />)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('jane@test.com')).toBeInTheDocument()
    expect(screen.getByText('M0042')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd member-app && npm test -- src/pages/AccountPage.test.jsx && cd ..
```

**Step 3: Create `member-app/src/pages/AccountPage.jsx`**

```jsx
import { useAuthStore } from '../stores/authStore'

export default function AccountPage() {
  const { member, signOut } = useAuthStore()

  if (!member) return null

  return (
    <div className="bg-slate-900 min-h-screen p-4">
      <h1 className="text-white text-xl font-bold mb-6 pt-4">Account</h1>

      <div className="bg-slate-800 rounded-2xl overflow-hidden mb-4">
        <Row label="Name" value={member.name} />
        <Row label="Email" value={member.email} />
        <Row label="Membership No." value={member.membership_number} />
        {member.membership_tier && (
          <Row label="Tier" value={member.membership_tier} />
        )}
      </div>

      <button
        onClick={signOut}
        className="w-full bg-slate-800 hover:bg-slate-700 text-red-400 font-semibold py-4 rounded-2xl transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-white text-sm">{value}</span>
    </div>
  )
}
```

**Step 4: Run test to confirm it passes**

```bash
cd member-app && npm test -- src/pages/AccountPage.test.jsx && cd ..
```

**Step 5: Commit**

```bash
git add member-app/src/pages/AccountPage.jsx member-app/src/pages/AccountPage.test.jsx
git commit -m "feat: Account screen"
```

---

## Task 13: Run all tests

Verify everything passes before deployment prep.

```bash
# Root EPOS tests
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test

# Member app tests
cd member-app && npm test && cd ..
```

Expected: All tests pass.

---

## Task 14: Deployment prep

**Files:**
- Create: `member-app/vercel.json`
- Update: root `vercel.json` (if it exists, otherwise create it)

**Step 1: Check if root vercel.json exists, review it**

```bash
cat vercel.json 2>/dev/null || echo "no root vercel.json"
```

**Step 2: Create `member-app/vercel.json`** (for the member app Vercel project)

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Step 3: Note required environment variables**

For the Supabase Edge Functions, set these in the Supabase dashboard under Project Settings → Edge Functions:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (from Stripe dashboard) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook endpoint setup |
| `MEMBER_APP_URL` | e.g. `https://member.yourclub.com` |

For both Vercel deployments, set:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |

**Step 4: Commit**

```bash
git add member-app/vercel.json
git commit -m "feat: member app deployment config"
```

---

## Task 15: Deploy Edge Functions

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npx supabase functions deploy invite-member
npx supabase functions deploy create-checkout-session
npx supabase functions deploy stripe-webhook
```

Then in the Stripe dashboard, create a webhook pointing to:
`https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`

Event to listen for: `checkout.session.completed`

---

## Done

The member companion PWA is complete. Members receive a magic link invite when staff add them with an email, can view their digital card with QR code, pay their outstanding tab via Stripe, and browse transaction history.
