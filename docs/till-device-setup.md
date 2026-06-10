# Till device identity — setup & RLS rollout runbook

Task 4 hardening replaced the "Allow all" RLS policies with **till device
identity**: each physical till signs into a dedicated Supabase auth user
once, and every till policy checks `is_till_device(auth.uid())`. Members
keep their read-own policies; the bare anon key can no longer read or write
anything.

## What ships in which layer

| Layer | Change |
|---|---|
| `20260610160000_pin_attempts.sql` | PIN lockout state table (RLS, no policies — service role only) |
| `20260610170000_till_device_rls.sql` | `till_devices` + `is_till_device()`, drops "Allow all", till-only policies everywhere, re-enables RLS on z_reports, SECURITY DEFINER + till-check on the two money RPCs, revokes on webhook helpers |
| `supabase/functions/verify-pin` | 5 failed attempts → 15-minute lock; covers verify mode AND set-mode `current_pin`; returns `{ valid:false, reason:'locked', retryAfterSeconds }` |
| Till bundle | `DeviceGate` wraps the app: one-time device sign-in, session persists in localStorage and auto-refreshes; till_id syncs from `till_devices`; PIN screens show a calm lockout countdown |

## Production rollout — single push, pub closed

Already done ahead of time (2026-06-10):
- pin_attempts migration applied to production; updated verify-pin deployed
  (brute-force lockout has been live since then)
- Device auth users created: `till-1@fairmile.club`, `till-2@fairmile.club`
  (passwords held by Eoghain — never in this repo)
- Device registration is migration `20260610180000_register_till_devices.sql`
  (guarded — no-ops where the auth users don't exist), so it lands in the
  same db push as the policies: no manual-SQL race window.

The repo is git-connected to both deploy paths: a push to master triggers
`.github/workflows/migrate.yml` (supabase db push) AND the Vercel project
(club-epos) which serves the till bundle. So the flip is ONE push:

1. **Pub closed.** Be at the till (or able to reach it).
2. `git push` master. Wait for the GitHub Action to go green and Vercel to
   finish deploying (~2 minutes).
3. **At the till:** reload the app (the PWA auto-updates on reload). It shows
   "Connect This Till" — enter `till-1@fairmile.club` + its password once.
4. Staff PIN screen appears; log in and **ring a test sale**.
5. **Run the verification checklist below** (the anon/member parts are
   runnable from any machine with curl).

The brief window during step 2–3 where new policies meet the old cached
bundle just means failed requests on a closed pub's till; the reload clears
it.

Rollback: if anything is wrong, re-creating the permissive policies restores
the old behaviour instantly (`create policy "Allow all" on <table> for all
using (true) with check (true);` on the affected table) — fix forward from
there rather than reverting the whole migration.

## Verification checklist (staging first, then production)

All of this passed on local staging on 2026-06-10.

**Till works:**
- [ ] Till boots straight to Staff Login (cached device session, no gate shown)
- [ ] Staff list loads on the PIN screen
- [ ] Ring a cash sale → order + items + stock movement land, stock decrements once
- [ ] Tab sale and tab settle work (RPCs)
- [ ] Z report opens and Close Day saves
- [ ] Reboot the till → no device login prompt (session persisted)
- [ ] Pull the network cable, ring a sale, reconnect → order syncs, no duplicate

**Member app unchanged:**
- [ ] Member can log in and see their own profile/balance
- [ ] Member sees their own orders only
- [ ] Member CANNOT see other members, stock movements, or z_reports (empty results)
- [ ] Member calling `adjust_tab_balance` RPC gets "permission denied: till devices only"

**Anon key alone is inert** (use curl with just the anon key):
- [ ] `GET /rest/v1/members` → `[]`
- [ ] `GET /rest/v1/orders` → `[]`
- [ ] `GET /rest/v1/z_reports` → `[]`
- [ ] `POST /rest/v1/orders` → RLS violation
- [ ] `PATCH /rest/v1/members` (tab_balance) → 0 rows updated
- [ ] `POST /rest/v1/rpc/create_order_with_items` → permission denied
- [ ] `POST /rest/v1/rpc/adjust_tab_balance` → permission denied

**PIN lockout:**
- [ ] 5 wrong PINs → calm amber countdown ("Try again in 14:5x"), numpad disabled
- [ ] While locked, the CORRECT PIN is also rejected (locked response — no oracle)
- [ ] Set-mode PIN change with wrong `current_pin` counts toward the same lock
- [ ] After a successful verify, the failure counter resets
- [ ] Another staff member can still log in while one is locked

## Day-to-day notes

- A locked PIN clears itself after 15 minutes; to clear it early run
  `delete from pin_attempts where member_id = '<member uuid>';` in the SQL editor.
- If a till device credential is ever compromised, delete its row from
  `till_devices` (instant lockout) and/or delete the auth user, then make a
  fresh one — no migration needed.
- The local staging stack mirrors all of this; see the memory note
  `local-staging-setup` for quirks (staging till user: `till-1@dionysus.local`).
