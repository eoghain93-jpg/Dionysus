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

## Production rollout — IN THIS ORDER

Do this while the pub is closed. Steps 4→5 have a sub-minute window where
the till can't read data (signed in but not yet registered as a device), so
have the step-5 SQL ready to paste.

1. **Create the device auth users** (Dashboard → Authentication → Add user):
   - `till-1@<your-domain>` with a strong unique password
   - `till-2@<your-domain>` likewise (when the second till arrives)
   - Tick "Auto Confirm User". Note each user's UUID.
   - These are DEVICE credentials, not staff logins — write them down once,
     they're entered once per till and never again.

2. **Deploy the updated verify-pin function** (safe before the migrations —
   it only needs pin_attempts at lock time; do it together with step 4):
   ```bash
   supabase functions deploy verify-pin
   ```

3. **Deploy the new till bundle.** Each till now shows "Connect This Till" —
   enter that till's device email + password once. (Old policies are still
   active, so the till keeps working normally after sign-in.)

4. **Apply the migrations:**
   ```bash
   supabase db push --linked
   ```

5. **Immediately register the devices** (Dashboard → SQL editor — paste,
   replacing the UUIDs from step 1):
   ```sql
   insert into till_devices (auth_user_id, till_id, name) values
     ('<till-1-user-uuid>', 'till-1', 'Main bar till');
   -- add till-2 when it exists:
   -- ('<till-2-user-uuid>', 'till-2', 'Lounge till');
   ```

6. **Run the verification checklist below.**

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
