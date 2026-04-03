# Design: Cashback, Edit Tabs, Partial Tab Payment + Promos Bug Fix

Date: 2026-04-02

## 1. Promos Bug Fix

**Root cause:** `promotions.js` queries `promotion_categories(*)` via a PostgREST foreign-key join. The `promotion_categories` migration ran after the schema cache was last loaded, so Supabase/PostgREST has no record of the relationship.

**Fix:** Reload the schema cache in the Supabase dashboard: API Settings → Reload schema cache. No code changes required.

**Verification:** After reload, adding a promotion with category discounts should save without error.

---

## 2. Cashback

A customer pays by card and receives physical cash from the till. This must be tracked so the till float reconciles at end of night.

### Database

New migration `supabase/migrations/20260402_cashback_transactions.sql`:

```sql
create table cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null,
  staff_id uuid references staff(id),
  till_id text not null default 'till-1',
  created_at timestamptz default now()
);
```

Payment method is always card (cash leaves the till, card covers it) — no need to store it.

### UI

- New **Cashback** button on TillPage alongside Wastage and Staff Drink buttons
- Opens `CashbackModal` — staff enter the amount, confirm
- Same interaction pattern as `WastageModal`

### Lib

New `src/lib/cashback.js`:
- `recordCashback(amount, staff_id)` — inserts a row into `cashback_transactions`

### Z Report

Cashback total shown as a cash-out line in the Z report so staff can reconcile the till float.

---

## 3. Edit Tabs

Two new actions added to each expanded tab row in TabsPage.

### 3a. Adjust Balance

- **"Adjust"** button opens a modal with:
  - +/- amount input
  - Mandatory reason field (free text)
- Logs to a new `tab_adjustments` table (audit trail)
- Updates `tab_balance` on the member by the adjustment amount

New migration `supabase/migrations/20260402_tab_adjustments.sql`:

```sql
create table tab_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id),
  amount numeric(10,2) not null,  -- negative = reduction, positive = addition
  reason text not null,
  staff_id uuid references staff(id),
  created_at timestamptz default now()
);
```

### 3b. Remove Order

- Each order in the expanded tab view gets a **"Remove"** button
- Inline confirmation prompt ("Are you sure?") before acting
- Sets `payment_method = 'removed'` on the order (preserves the record)
- Deducts the order's `total_amount` from the member's `tab_balance`

### Lib

New functions in `src/lib/tabs.js` (or `members.js`):
- `adjustTabBalance(member_id, amount, reason, staff_id)` — inserts adjustment record, updates member balance
- `removeOrderFromTab(order_id, member_id, order_total)` — sets order payment_method to 'removed', deducts from tab_balance

---

## 4. Pay Part of a Tab

### Changes to SettleTabModal

- Add an amount input, pre-filled with the full `tab_balance`
- Staff choose cash or card as before
- If amount === full balance: behaviour identical to today (tab zeroed)
- If amount < full balance: deduct entered amount, leave remainder on tab

### Validation

- Amount > 0
- Amount ≤ full tab balance
- Decimal input allowed (pence)

### Lib change

`settleTab(member_id, amount, payment_method)` in `members.js`:
- Currently always sets `tab_balance: 0`
- Change to: `tab_balance: currentBalance - amount`
- Re-fetch current balance before update (pattern already used in `addToTabBalance`)
