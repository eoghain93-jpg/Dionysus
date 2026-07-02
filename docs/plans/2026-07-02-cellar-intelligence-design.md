# Cellar Intelligence — Design Document

**Date:** 2026-07-02
**Status:** Draft for discussion

## The pitch

A stock system a bar manager actually trusts and enjoys using. Not a grid of
numbers — a colleague that says, in plain English:

> "You'll run out of Guinness on Friday. Order 3 kegs from Heineken today
> and they'll arrive in time. Tap to send the order."

> "Something's off with the vodka — the till says you should have 12 bottles,
> the shelf says 9. That's £270 at retail. Here's the week it started."

Everything the system says is a sentence, a £ figure, or a single button.
The sophistication (forecasting, variance analysis, margin maths) lives under
the surface; the manager never sees a term like "par level drift" or
"depletion coefficient".

## Why this is buildable *now*

The hard plumbing already exists and is live in production:

- **Every stock change is already an event.** `stock_movements` records
  sale / restock / wastage / spillage / adjustment / staff_drink /
  staff_credit_redemption, and the `apply_stock_movement` trigger (migration
  `20260527150000`) keeps `products.stock_quantity` continuously up to date —
  including sales, online and offline-synced alike. (The comment in
  `src/lib/stocktake.js` claiming sales don't decrement stock predates this
  and is fixed alongside this doc.)
- **Purchasing tables exist with no UI.** `purchase_orders` (draft → sent →
  received) and `purchase_order_items` (quantity_ordered, quantity_received,
  unit_cost) have been in the base schema from day one. Suppliers have
  emails. Cellar Intelligence is largely the missing UI for them.
- **`cost_price` is already on products** — margin maths needs no schema
  change.
- **Email infrastructure exists** (Resend edge functions, recipient lists) —
  the weekly cellar digest and "email PO to supplier" reuse it directly.
- **Offline queue + idempotent movements** (fixed 2026-07-02) mean stocktake
  counts and deliveries logged in a dodgy-wifi cellar don't get lost or
  double-applied.

## The manager's mental model (design north star)

A bar manager thinks in **containers and sessions**, not units and rows:

- "I have 4 kegs and a bit in the cellar" — not "352.5 pints".
- "The weekend is coming" — not "7-day trailing mean daily depletion".
- "The Smirnoff is going missing" — not "variance −3.0 units".
- "What do I need to order from each rep this week?"

Every screen speaks that language. Three rules, enforced everywhere:

1. **Sentences, not tables.** Tables exist one tap deeper, for checking.
2. **Everything valued in £** (retail for shrinkage — that's what it costs
   the club; cost for ordering — that's what the bank sees).
3. **One primary action per card.** "Order now", "Count this shelf",
   "Mark as delivered". No forms with ten fields.

---

## The four pillars

### 1. Live cellar truth (make the numbers believable)

Trust is the foundation — a manager who catches the system saying "8 kegs"
when there are 6 never looks at it again. Two gaps to close:

**a) Containers.** Today `stock_quantity` counts servings (pints, measures,
bottles). Managers count containers. Add to `products`:

| column | example (Guinness) | example (Smirnoff) |
|---|---|---|
| `container_name` | keg | bottle (70cl) |
| `servings_per_container` | 88 | 28 |
| `case_size` (for bottles/cans) | — | 6 |

Display becomes bilingual: **"4 kegs + 26 pints"** with "378 pints" in small
print. Input becomes container-first: a delivery is "3 kegs", a stocktake
count is "4 kegs, roughly ⅓ left in the tapped one" (slider for the partial —
nobody knows the exact pints in a live keg, and pretending otherwise destroys
trust; the system tracks a ± band instead).

**b) Guided stocktake.** Replace "external stocktaker compares a CSV" with a
first-class flow on a phone/tablet in the cellar:

1. Tap **Start a count** → pick scope (everything / one category / one shelf).
2. Products appear one at a time, container-first: "Guinness — how many
   kegs?" [stepper] "and the open one?" [empty ▁▂▃▄▅ full].
3. Works fully offline (it's a cellar) — counts queue like till orders.
4. Finish → the system shows **only the surprises**: "Expected 12 bottles of
   Smirnoff, you counted 9 — £270 at retail. Confirm the count or recount?"
5. Confirm → snapshot saved, one `adjustment` movement per product
   re-baselines `stock_quantity`, tagged with the stocktake id so history
   shows *why* stock jumped.

New tables:

```sql
stocktakes        (id, started_at, completed_at, scope, staff_id, notes)
stocktake_lines   (id, stocktake_id, product_id,
                   expected_qty,      -- stock_quantity at count time
                   counted_qty,       -- what the human saw
                   variance_value_retail, variance_value_cost)
-- + stocktake_id column on stock_movements (nullable, FK)
```

Between counts, the dashboard shows **"last verified 12 days ago"** per
product — an honesty indicator that tells the manager how much to trust the
number, and nudges little-and-often counting (count the spirits every Monday,
the cellar monthly) instead of the dreaded quarterly all-nighter.

### 2. Run-out forecasting ("will I make it to the weekend?")

The signal is already in `stock_movements`: every sale, timestamped, per
product, for months. The forecast is deliberately simple and explainable —
no black box, because the manager must be able to argue with it:

- **Day-of-week profile:** average depletion per weekday over the last 6
  weeks (a pub's Friday is not its Tuesday). Recent weeks weighted heavier.
- **Event uplift:** the promotions table already knows match nights. When a
  day carries a promo (or the manager tags it "big night"), scale that day by
  the uplift observed on similar past days — shown as its own line:
  "Fridays you pour ~110 pints; match-night Fridays, ~180."
- **Output per product: a run-out date**, not a rate. "Runs out **Fri
  evening**" is actionable; "9.3/day" is not.

The Stock page's RAG badge becomes forecast-driven: red = runs out before
the next realistic delivery, amber = within 7 days, green = fine. The
current par-level RAG stays as a fallback for products with thin sales
history.

No new infrastructure: computed client-side from paged `stock_movements`
queries (the `fetchAllPages` pattern), cached in Dexie for offline. A
Postgres view can come later if it's slow; don't build it speculatively.

### 3. One-tap ordering (the missing purchase-orders UI)

The weekly ritual today: walk the cellar with a notepad, text three reps.
Replace it with:

**"Suggested order — Heineken UK (rep: Dave)"**
> 3 × keg Guinness (runs out Fri) · 2 × keg Carlsberg (runs out Sun) ·
> 4 × case Peroni (runs out next Wed)
> **≈ £412 cost** — [Adjust] [Send to Dave]

- Suggestions come straight from pillar 2: everything whose run-out date
  falls before the *next* delivery would land (per-supplier
  `lead_time_days` + optional delivery weekday, new columns on `suppliers`),
  rounded up to whole containers/cases.
- **Send** creates the `purchase_orders` row (status `sent`) and emails a
  tidy PO to the supplier's email via a new `send-purchase-order` edge
  function (clone of the existing report emailers, with the caller check
  from the security review).
- **Delivery day:** open the PO, tick lines off against the van ("ordered 3,
  got 3" pre-filled; edit if short), tap **Received** → sets
  `quantity_received`, stamps `received_at`, and writes the `restock`
  movements automatically — stock is right without anyone typing numbers
  twice, and `unit_cost` quietly updates `cost_price` when it changed
  (with a "Peroni cost went up 6% — your margin is now 58%" note).
- Par levels stop being static config nobody updates: the system suggests
  **"working par"** = expected depletion over lead time + safety margin, and
  shows both ("par says 2, your Fridays say 4").

### 4. Shrinkage, variance & margin (the money layer)

Where the manager's boss (committee/treasurer) gets their answers:

- **Variance report** per stocktake period, valued at retail and cost,
  split by *explained* (logged wastage/spillage/staff drinks — already
  distinct movement types) vs *unexplained* (the gap the count revealed).
  Headline: "Unexplained loss this month: £84 — 1.1% of sales. Last month:
  £61." With a per-product drill-down and the week the drift started
  (walk the movement history backwards).
- **Draught yield:** pints sold per keg vs the 88 theoretical — line
  cleaning, foam and over-pour show up here. "Your Guinness kegs are
  yielding 83/88 — that's ~£37/keg."
- **Margin lens:** GP% per product/category from `cost_price` vs actual
  sold prices (promos and member pricing included, from `order_items` —
  *actual* margin, not list margin). Flag: "Bottled cider GP is 51%, your
  target is 60% — the 5-for-4 deal is doing that."
- **Dead money:** "£312 of stock hasn't sold in 6 weeks (4 products) —
  promo it or stop ordering it." (Feeds the promo engine — one tap to draft
  a promotion for a dead product.)
- **Weekly cellar digest email** (reuse Resend + recipients pattern): five
  sentences — running low, order today, unexplained variance, best/worst
  margin mover, dead stock. The manager who never opens the app still gets
  the value.

---

## The dashboard (what the manager actually sees)

A new **Cellar** page, three cards, top to bottom by urgency:

```
┌─ ORDER TODAY ────────────────────────────────────────┐
│ Guinness runs out Friday. Carlsberg Sunday.          │
│ Suggested order for Heineken UK — ≈ £412             │
│                              [Adjust]  [Send order]  │
├─ RUNNING LOW ────────────────────────────────────────┤
│ Smirnoff (4 days) · Peroni (6 days) · Merlot (6 days)│
│ Covered by the order above except Merlot (LWC).      │
├─ WORTH A LOOK ───────────────────────────────────────┤
│ Spirits last counted 19 days ago.    [Count spirits] │
│ Unexplained vodka gap: £270 since the 14th. [Detail] │
└──────────────────────────────────────────────────────┘
```

Empty states matter: when nothing needs doing the page says **"Cellar's in
good shape. Next delivery Thursday (Heineken). Nothing running low."** —
that sentence is what builds the daily-glance habit.

## Build order

**Phase 1 — Truth (foundation, ~1 week):**
containers on products (+ bilingual display on Stock page), guided stocktake
flow (offline-capable), stocktake tables + adjustment re-baselining, "last
verified" indicator. *Ship value immediately: the count flow alone beats the
notepad.*

**Phase 2 — Foresight (~1–2 weeks):**
depletion profiles + run-out dates, forecast-driven RAG on the Stock page,
supplier lead times, suggested orders, PO send/receive flow with automatic
restocks. *This is the "revolutionary" moment — the notepad walk dies here.*

**Phase 3 — Money (~1 week):**
variance report (explained vs unexplained), draught yield, margin lens, dead
stock, weekly digest email, committee-ready monthly cellar summary alongside
the existing accountant report.

Dependencies & cautions:
- Phase 1 needs nothing new server-side except the two tables + columns.
- The PO email function must ship with a proper caller check (see the
  security section of `docs/2026-07-02-review-and-revolutionary-roadmap.md`
  — don't add another anon-key-trusting emailer).
- Forecast quality depends on sale movements, which have flowed since
  migration `20260527150000` — by build time there will be months of
  history; products with less than ~3 weeks fall back to par-level RAG.
- Day-boundary maths should use the trading-day helper proposed in the
  review (a 00:30 Saturday sale belongs to Friday night's session) — build
  it once here and the Z-report fix gets it for free.

## Out of scope (deliberately)

- Recipe/cocktail-level depletion (measures per cocktail) — the club sells
  simple serves; revisit if food/cocktails grow.
- Supplier price-list ingestion/EDI — `unit_cost` on received POs captures
  cost drift with zero integration work.
- Automated ordering without a human tap — the manager always sends; the
  system only drafts. Trust first, automation later.
