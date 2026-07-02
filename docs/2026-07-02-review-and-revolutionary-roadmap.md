# Dionysus — Codebase Review & Revolutionary Feature Roadmap

**Date:** 2026-07-02
**Scope:** Full review of the staff till app (`src/`), the Supabase backend
(`supabase/`), and the member companion PWA (`member-app/`) + offline/print
infrastructure. Findings verified against the actual code, not the plans.

---

## TL;DR

Dionysus is a genuinely impressive members'-club EPOS: atomic offline-safe
order pipeline, server-side PIN handling, one source of pricing truth, tight
final-state RLS, and broad money-path test coverage. It is well past MVP.

But before shipping anything "revolutionary" on top, three foundations need
fixing, because they undermine trust in the money and the data:

1. **The staff-login trust boundary is inverted.** Only the till page is
   PIN-gated. Tabs, members, stock, reports and settings are wide open on a
   logged-out till — including a one-tap, no-confirm "remove tab order" that
   restocks stock and cuts a member's balance.
2. **Offline mode is silently broken on the read side**, and offline stock
   syncs can silently lose data. The write/queue path is solid; the read path
   and the stock-movement drain are not.
3. **Several edge functions trust any caller holding the public anon key** —
   which ships in the browser bundle. That turns "set staff PIN", "invite
   member", and the report emailers into an open surface.

Fix those, and the platform is a rock-solid base for the flagship features in
Part 3 — which are unusually reachable here because the member PWA, Stripe,
wallet passes, promotions engine, and real-time Supabase are *already built*.

---

# Part 1 — What's genuinely well built

- **Idempotent offline order pipeline.** Every order carries a
  client-generated UUID that travels through the Dexie queue into a single
  atomic `create_order_with_items` RPC (`order + items + stock movements +
  tab increment`), which upserts `ON CONFLICT (id) DO NOTHING`. A crash
  between insert and queue-delete replays as a server-side no-op — and there's
  a test proving exactly that (`src/lib/sync.test.js`).
- **PIN security done right.** Verification, lockout and PIN-setting live in
  the `verify-pin` edge function; no hash ever reaches the client; the session
  stores only `{id, name}`. PINs are bcrypt-hashed and the compare is skipped
  while locked (no timing oracle).
- **One source of pricing truth.** `resolveSalePrice` / `bottleBundlePricing`
  are shared by the grid tiles, the bundle previews, and the cart, so the
  displayed price can't drift from the charged price.
- **Tight final-state RLS.** The "allow all" era is fully dropped;
  `20260610200000` defensively deletes drifted policies by keep-list; every
  till policy runs through one `SECURITY DEFINER is_till_device()` with pinned
  `search_path`; money RPCs re-check the caller *inside* the function body.
- **PostgREST 1000-row truncation defended everywhere** via `fetchAllPages`,
  with comments explaining why.
- **Broad, real money-path test coverage** (promos, tillStore, zReport,
  monthlyReport, tabs, settle/cash modals, sync replay) — these test
  invariants, not just render.

---

# Part 2 — Issues to fix first (prioritised)

Severity: 🔴 ship-blocker · 🟠 important · 🟡 cleanup. Each has been verified in
code; file:line references included.

## 🔴 Critical

### C1 — Inverted auth: the whole app minus the till has no login
`src/App.jsx:14-31` routes `/tabs`, `/members`, `/stock`, `/settings`,
`/reports`, `/monthly-report`, `/stocktake` straight through `DeviceGate` with
no `activeStaff` check; only `TillPage` gates on PIN
(`src/pages/TillPage.jsx:115`). On a logged-out till anyone can void a tab
order (restocks stock, cancels staff credits, cuts the member's balance — one
tap, **no confirmation, no PIN**, `src/pages/TabsPage.jsx:72-90`), apply
arbitrary tab adjustments with `staff_id: undefined`
(`src/components/members/AdjustTabModal.jsx:30`), edit member PII and prices,
and export order CSVs. Meanwhile the far less dangerous cash↔card correction
*is* PIN-gated. **Fix:** wrap the authenticated routes in a shared
`RequireStaff` gate; add a confirm + PIN to the tab-void button.

### C2 — Edge functions trust the public anon key
The anon key ships in the client bundle, yet several functions treat "has a
valid platform JWT" as authorisation:
- `verify-pin` **set mode** with a null `pin_hash` writes a new PIN with *no*
  caller check (`supabase/functions/verify-pin/index.ts`) — anyone can claim a
  new staff member's PIN, or lock any staff member out at will (griefing DoS).
- `invite-member` lets any authenticated member rebind *any* member row's
  `auth_user_id` to an email they control — then read that person's balance
  and order history via the member read-own policies. The code comment admits
  the gap.
- `send-z-report` / `send-stocktake` / `send-monthly-report` are an open mail
  relay: caller-supplied recipients **and** body, sent from the club's Resend
  domain. Z-report figures are never cross-checked against the DB.
- Wallet-pass functions return member PII (name + membership number, i.e. the
  bar credential) to any anon-key caller given a member UUID;
  `send-wallet-pass-email` even accepts `override_email`.

**Fix (one shared helper, ~20 lines):** resolve the JWT with `auth.getUser()`
and require `till_devices` membership (or an `X-Internal-Secret` for the DB
trigger's call into `send-wallet-pass-email`).

### C3 — Offline reads are dead (boolean IndexedDB index)
`src/lib/db.js:6-7` indexes `active`; `src/lib/products.js:22` and
`src/lib/members.js:20` query `where('active').equals(1)`. `active` is stored
as boolean `true`, and **IndexedDB cannot index boolean keys**, so offline the
product grid and member list come back empty — exactly when offline support
matters. (`searchMembersByName` works because it uses `.filter()` — the
inconsistency is the tell.) **Fix:** `db.products.filter(p => p.active)…` or
store `active` as `1/0`.

### C4 — Offline stock-movement sync silently loses data
`src/lib/sync.js:31` — `await supabase.from('stock_movements').insert(movement)`
returns `{error}`, it does not throw, so the `catch` is dead code and the queue
entry is deleted even on RLS/network rejection. Offline wastage/restock
movements vanish. Untested. **Fix:** destructure `{ error }` and `throw`/`break`
before the delete (2 lines). Add the missing test.

## 🟠 Important

### I1 — Floating-point pence throughout the money path
Prices are pound floats and totals are never rounded before persistence:
`getTotal()` sums raw floats (`src/stores/tillStore.js:274`) and that value is
written as `total_amount` (`src/pages/TillPage.jsx:79`). `3 × £1.10` stores
`3.3000000000000003`, which flows into the orders CSV
(`src/components/reports/ReportsPage.jsx:44`) and accumulates in report sums.
`toFixed(2)` only masks it on screen. `CashPaymentModal` already works in
integer pence — the pattern exists, just isn't used where it's persisted.
**Fix:** a `round2`/`toPence` helper at subtotal + `getTotal` + save.

### I2 — Tab settlement is non-atomic and a retry double-charges
`src/lib/members.js:110-135`: `applyTabDelta(-amount)` commits, then
`last_settled_at`, then the settlement `orders` insert. If the insert fails the
tab is already reduced with no matching order; the modal shows an error and the
natural staff response — tap "Settle by Card" again — reduces the balance a
second time. **Fix:** move the whole settlement into one RPC (mirror
`create_order_with_items`), or make it idempotent on a client key.

### I3 — `removeOrderFromTab` is a 4-step client-side saga
`src/lib/tabs.js:65-113`: restock → void → cancel credits → tab delta, each a
separate request, no idempotency key; retrying re-inserts restocks, and
`TabsPage.jsx:85-86` swallows failure with `console.error` only. **Fix:** one
RPC, mirroring the order path.

### I4 — Sync only fires on an offline→online *transition*
`syncAll` is called solely from the `window 'online'` listener
(`src/lib/sync.js:48-59`); never at startup, no retry/backoff, no poison-entry
handling (`break` on first error blocks the queue forever). `pendingCount`
starts at 0 and is only set inside `syncAll`, so the status bar lies after a
reload. **Fix:** call `syncAll()` once on mount, add an in-flight guard, and a
retry cap / dead-letter for permanently-rejected entries.

### I5 — Membership-number generation races (two divergent generators)
The webhook uses `count(*)+1` (`stripe-webhook`), the till uses
`max(M####)+1` after a full-table scan (`src/lib/members.js:74-85`). Concurrent
creates collide; the webhook's collision → 500 → Stripe retries forever → a
*paid* member never gets created. `members.email` has no unique constraint.
**Fix:** a Postgres sequence (`'M' || lpad(nextval(...),4,'0')`) + unique index
on email.

### I6 — Report/day boundaries use zoneless UTC strings
Day-bounded queries compare `created_at` (UTC ISO) against `${date}T00:00:00`
interpreted as UTC (`zReport.js`, `cashback.js`, `prizeWins.js`,
`monthlyReport.js`, `ReportsPage.jsx`, `orders.js`). For a UK club in BST a
00:30 sale lands on the previous day's Z-report, and there's no
trading-day-past-midnight concept despite bundles explicitly serving late.
`.lte('…T23:59:59')` also drops the final sub-second. **Fix:** a single
trading-day helper (configurable cutover, e.g. 05:00 local) used everywhere.

### I7 — Z-report "Top Products" counts voided/refunded orders
`zReport.js:176-180` joins order_items on date only — no `status`/payment
filter — while the weekly summary correctly filters `status = 'paid'`. Same gap
in the 7-day `TopProducts` widget. **Fix:** filter `status='paid'`.

### I8 — Stock is presented as live but sales never decrement it
Acknowledged in `src/lib/stocktake.js:10-14`, yet `ProductGrid` shows a
low-stock dot and `StockList` shows RAG badges off `stock_quantity` vs
`par_level`. Staff learn to ignore the indicators. **This is the natural anchor
for the "Cellar Intelligence" feature in Part 3** — close the loop and the
indicators become real.

## 🟡 Cleanup
- `verify-pin` lockout is a race-bypassable read-modify-write and resets to 0
  after each 15-min window (~480 guesses/member/day); make it an atomic
  upsert-increment RPC.
- Order totals/prices are trusted from the client inside
  `create_order_with_items` — recompute server-side as defence in depth.
- Stripe webhook idempotency keyed on non-unique `members.email`.
- Print bridge (`scripts/print-bridge.mjs`) is callable by any web page
  (`ACAO: *` + `Access-Control-Allow-Private-Network`) — any drive-by page on
  the till machine can pop the cash drawer. Add an `X-Bridge-Token`.
- Dead `tabs` table is a stale second source of balance truth (seed populates
  it, nothing updates it). Drop or make a view.
- `seed.sql` duplicates on re-run (products have NULL `sku`, so
  `ON CONFLICT (sku)` never fires). Give real SKUs.
- Hard-coded prod URL + anon JWT baked into the wallet-email migration.
- Member-app PWA manifest references icons that don't exist (no `public/`) →
  breaks install; auth dead-ends (no "resend link", expired-link never
  surfaced); stale tab balance after Stripe redirect (no refetch).
- SwitchUserModal reimplements PIN verify without the lockout protocol (3rd
  copy); `membersOnlyMode` leaks across staff switches.
- `refunded` status is summed in every report but there is no refund UI;
  `spillage` movement type is wired but unreachable; `StarWebPrintBuilder.js`
  is 30KB of dead code.

---

# Part 3 — Revolutionary features to ship

The through-line: **you already own the member's phone.** The companion PWA,
Stripe, Apple/Google wallet passes, the promotions engine, real-time Supabase,
and a live tab ledger are all built. The revolutionary step is to stop treating
the phone as a read-only card and make it an active participant in the night —
ordering, paying, splitting, and being rewarded — while the till becomes the
hub of a connected venue rather than a standalone box.

These are ordered by **impact-to-effort**, with the infra they reuse.

## ⭐ Flagship: Order & Pay from your seat ("Tap to Round")
**What:** A member opens the PWA, sees the live menu (with member pricing and
tonight's match-night promos already applied), builds a round, and pays with
their card-on-file — or drops it straight onto their tab. The order lands on a
till/KDS queue with their name and table, staff tap "accept", it prints to the
bar. No queueing at the bar on a match night.

**Why revolutionary here:** this is the single biggest lever for a busy club —
it removes the bar queue, increases round sizes (frictionless top-ups), and
captures every order against a member profile. Competitors charge per-cover for
this; you'd own it end to end.

**Reuses:** member auth + PWA, `create-checkout-session` (extend to a
tab/card-on-file charge), the promotions engine and `resolveSalePrice`, the
existing print bridge, Supabase Realtime for the incoming-order queue.

**New work:** an `order_requests` table + RLS (member inserts own, till reads
all), a Realtime subscription on the till, an "incoming orders" panel, and
server-side price recomputation (which C2/cleanup want anyway). Card-on-file
needs Stripe SetupIntents. **Effort: L**, but mostly assembly of existing parts.

## ⭐ Split the tab / "Get this round"
**What:** Any member on a shared tab can settle their share from their phone, or
one member can pick up a round and have it auto-attributed. Group tabs with a
nominated host and per-member sub-balances.

**Why:** clubs run on rounds and shared tabs; today settlement is a staff
chore at the till. Self-service splitting is a genuine "how did we live without
this" feature and it accelerates cash collection.

**Reuses:** the tab ledger, `adjust_tab_balance`, Stripe checkout, member auth.
**New work:** a `tab_shares` concept + settlement RPC. **Effort: M.**
*Prerequisite: fix I2/I3 first — do not build splitting on a non-atomic tab.*

## Push-driven match-night engine
**What:** Promotions already support time windows, days-of-week, and
midnight-spanning. Add Web Push so the moment "50p off pints" goes live, every
member in the building gets "🍺 Match-night pints now 50p — order from your
seat". Tie it to kickoff. Fire a "your tab is £42, last orders in 20 min"
nudge before close.

**Why:** turns a passive promo table into a demand-generation channel you
control, and it directly feeds the flagship ordering feature.

**Reuses:** the full promotions engine, the member PWA service worker (already
`autoUpdate`), the trading-day/close logic. **New work:** Web Push
subscriptions + a `send-push` edge function + a "presence" signal (member
checked in tonight — derivable from a card scan or a geofence). **Effort: M.**

## Loyalty & regulars: streaks, stamps, leaderboards
**What:** You already pay out fruit-machine prize wins and bank staff drinks —
the primitives for a rewards ledger exist. Layer a member-facing loyalty system:
visit streaks, "10th pint free" stamp cards per category, a monthly "top
regular" leaderboard, birthday/renewal perks auto-issued as a promo.

**Why:** members-club retention *is* the business model. Gamified regularity is
proven to lift frequency, and it makes the membership renewal (which the plans
call for but isn't built) something members chase rather than dread.

**Reuses:** order history, `prize_wins`, the promotions engine (perks = an
auto-issued member-scoped promo), wallet passes (show points on the card).
**New work:** a `loyalty_ledger` + accrual rules + a member-app rewards tab.
**Effort: M.**

## Cellar Intelligence (close the stock loop, then forecast)
**What:** First close the loop I8 flags — decrement `stock_quantity` on sale
(the atomic order RPC is the perfect place). Then, on top of real stock data:
auto-reorder suggestions at par level, wastage-vs-sales variance alerts, and a
demand forecast per fixture ("last three derby nights you sold 3 kegs by 9pm —
you have 2"). Feed the accountant/monthly report with true COGS.

**Why:** it's the difference between a till and a business system. Live margin
per session, spotting theft/over-pour via variance, and never running dry on
the big night are all high-value to an owner.

**Reuses:** `stock_movements` + trigger, `stocktake.js`, `monthlyReport.js`,
Recharts. **New work:** stock decrement in the order RPC (small, high-value),
a par-level reorder view, and a forecast query keyed on fixture dates.
**Effort: M** (decrement is S and unblocks everything).

## Tap-to-identify → tap-to-pay convergence
**What:** The wallet pass already carries the membership credential. Make the
same tap that identifies a member also authorise payment against card-on-file
or tab, so a regular can walk up, tap once, and have "the usual" charged — no
PIN, no card, no queue.

**Why:** the frictionless endgame of everything above; a signature members-club
experience.

**Reuses:** Web NFC (already in `MemberLookup`), wallet passes, tab ledger.
**New work:** card-on-file (shared with the flagship), a "usual order"
heuristic from favourite drinks. **Effort: M**, best shipped after the flagship.

---

# Recommended sequencing

1. **Stabilise (1 sprint):** C1–C4 + the quick wins (they're mostly 2–5 line
   fixes and several are prerequisites). This is non-negotiable before adding
   member-initiated money movement.
2. **Money hardening (1 sprint):** I1 (pence), I2/I3 (atomic tab RPCs), I5
   (membership numbers), server-side price recompute. Now the tab is safe to
   let members touch.
3. **Ship the flagship:** Order & Pay from your seat, then Split the tab. These
   two alone change what the venue feels like on a busy night.
4. **Compound the engagement:** push-driven promos → loyalty → cellar
   intelligence, in whatever order matches the season.

The unusual thing about this codebase is how little net-new infrastructure the
"revolutionary" tier needs — the hard parts (auth, payments, offline, real-time,
wallet, promos) are already here and well built. The work is mostly composition,
gated behind getting the money and trust boundaries airtight first.
