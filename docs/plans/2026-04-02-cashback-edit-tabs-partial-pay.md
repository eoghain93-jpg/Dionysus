# Cashback, Edit Tabs, Partial Tab Payment + Promos Bug Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the promos schema cache bug and add three new features: cashback tracking, tab editing (balance adjustment + order removal), and partial tab payment.

**Architecture:** Cashback uses a new `cashback_transactions` table and mirrors the WastageModal pattern on TillPage. Tab editing adds `adjustTabBalance` and `removeOrderFromTab` lib functions wired into the TabsPage expanded row. Partial payment extends the existing `SettleTabModal` with an amount input and updates `settleTab` to accept a partial amount.

**Tech Stack:** React, Supabase (PostgREST), Zustand, Vitest, @testing-library/react

**Test command prefix:** `export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" &&`

---

## Task 1: Fix Promos Schema Cache Bug

No code changes required. This is a Supabase configuration action.

**Step 1: Reload schema cache**

In the Supabase dashboard:
1. Go to **Project Settings → API**
2. Click **Reload schema cache** button

**Step 2: Verify fix**

Go to the Promos page in the app, click **Add Promo**, add a category discount, and save. The error "could not find a relationship between 'promotions' and 'promotion_categories'" should no longer appear.

**Step 3: If dashboard button doesn't work**

Run this in the Supabase SQL Editor:
```sql
NOTIFY pgrst, 'reload schema';
```

---

## Task 2: Cashback — Database Migration

**Files:**
- Create: `supabase/migrations/20260402_cashback_transactions.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/20260402_cashback_transactions.sql
create table cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount > 0),
  staff_id uuid references members(id),
  till_id text not null default 'till-1',
  created_at timestamptz default now()
);
```

Note: `staff_id` references `members(id)` — staff are stored in the members table with a `pin_hash` column.

**Step 2: Run migration in Supabase**

Paste the SQL into the Supabase SQL Editor and run it.

**Step 3: Commit**

```bash
git add supabase/migrations/20260402_cashback_transactions.sql
git commit -m "feat: add cashback_transactions migration"
```

---

## Task 3: Cashback — Lib Functions

**Files:**
- Create: `src/lib/cashback.js`

**Step 1: Write the failing test**

Create `src/lib/cashback.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from './supabase'
import { recordCashback, fetchCashbackForDate } from './cashback'

beforeEach(() => vi.clearAllMocks())

describe('recordCashback', () => {
  it('inserts a cashback_transactions row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert })

    await recordCashback(10.00, 'staff-123')

    expect(supabase.from).toHaveBeenCalledWith('cashback_transactions')
    expect(insert).toHaveBeenCalledWith({
      amount: 10.00,
      staff_id: 'staff-123',
      till_id: 'till-1',
    })
  })

  it('throws if supabase returns an error', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    supabase.from.mockReturnValue({ insert })

    await expect(recordCashback(10.00, 'staff-123')).rejects.toThrow('db error')
  })
})

describe('fetchCashbackForDate', () => {
  it('returns total cashback amount for a date', async () => {
    const select = vi.fn().mockReturnThis()
    const gte = vi.fn().mockReturnThis()
    const lte = vi.fn().mockResolvedValue({
      data: [{ amount: 10 }, { amount: 5 }],
      error: null,
    })
    supabase.from.mockReturnValue({ select, gte, lte })

    const result = await fetchCashbackForDate('2026-04-02')
    expect(result).toBe(15)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/cashback.test.js
```

Expected: FAIL — `cashback.js` doesn't exist yet.

**Step 3: Write the implementation**

Create `src/lib/cashback.js`:

```js
import { supabase } from './supabase'

export async function recordCashback(amount, staff_id, till_id = 'till-1') {
  const { error } = await supabase
    .from('cashback_transactions')
    .insert({ amount, staff_id, till_id })
  if (error) throw error
}

export async function fetchCashbackForDate(date) {
  const from = `${date}T00:00:00`
  const to   = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('cashback_transactions')
    .select('amount')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
}
```

**Step 4: Run test to verify it passes**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/cashback.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/cashback.js src/lib/cashback.test.js
git commit -m "feat: add cashback lib with recordCashback and fetchCashbackForDate"
```

---

## Task 4: Cashback — CashbackModal Component

**Files:**
- Create: `src/components/till/CashbackModal.jsx`

**Step 1: Write the implementation**

Model this after `src/components/till/WastageModal.jsx`:

```jsx
import { useState } from 'react'
import { X } from '../../lib/icons'
import { recordCashback } from '../../lib/cashback'
import { useSessionStore } from '../../stores/sessionStore'

export default function CashbackModal({ onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    setSaving(true)
    setError(null)
    try {
      await recordCashback(val, activeStaff?.id)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to record cashback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record Cashback"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Record Cashback</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="cashback-amount" className="text-slate-300 text-sm">Amount (£)</label>
            <input
              id="cashback-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 20.00"
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/till/CashbackModal.jsx
git commit -m "feat: add CashbackModal component"
```

---

## Task 5: Cashback — TillPage Button

**Files:**
- Modify: `src/pages/TillPage.jsx`

**Step 1: Add import and state**

At the top of `TillPage.jsx`, add the import alongside the other modal imports:

```js
import CashbackModal from '../components/till/CashbackModal'
```

Add state after the existing `showStaffDrink` state (line ~23):

```js
const [showCashback, setShowCashback] = useState(false)
```

**Step 2: Add the button**

In the button row around line 85-98, add a third button after "Staff Drink":

```jsx
<button
  onClick={() => setShowCashback(true)}
  className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
>
  Cashback
</button>
```

**Step 3: Add the modal**

After the existing `{showStaffDrink && ...}` block, add:

```jsx
{showCashback && (
  <CashbackModal
    onClose={() => setShowCashback(false)}
    onSaved={() => setShowCashback(false)}
  />
)}
```

**Step 4: Verify manually**

Run the dev server and confirm the Cashback button appears on the TillPage alongside Wastage and Staff Drink. Clicking it should open the modal.

**Step 5: Commit**

```bash
git add src/pages/TillPage.jsx
git commit -m "feat: add Cashback button to TillPage"
```

---

## Task 6: Cashback — Z Report Integration

**Files:**
- Modify: `src/lib/zReport.js`
- Modify: `src/components/reports/ZReportModal.jsx`

**Step 1: Add cashback to fetchZReportData**

In `src/lib/zReport.js`, add the import at the top:

```js
import { fetchCashbackForDate } from './cashback'
```

Update the `Promise.all` at the bottom of `fetchZReportData`:

```js
const [wastage, staffDrinks, cashbackTotal] = await Promise.all([
  fetchWastageForDate(date),
  fetchStaffDrinksForDate(date),
  fetchCashbackForDate(date),
])

return { salesSummary, topProducts, wastage, staffDrinks, cashbackTotal }
```

**Step 2: Display cashback in ZReportModal**

In `src/components/reports/ZReportModal.jsx`:

Update `expectedInTill` calculation (around line 32) to subtract cashback:

```js
const cashbackTotal = data?.cashbackTotal ?? 0
const expectedInTill = openingFloat + cashSales - cashbackTotal
```

Find the cash reconciliation section in the JSX and add a cashback row. It will be in the rendered section — search for "Cash Reconciliation" or "expectedInTill" in the JSX and add a row alongside the existing cash summary lines:

```jsx
<div className="flex justify-between text-sm">
  <span className="text-slate-400">Cashback Given</span>
  <span className="text-red-400">-{fmt(cashbackTotal)}</span>
</div>
```

**Step 3: Add cashback to CSV export**

In `handleExportCSV`, add to the `lines` array in the Cash Reconciliation section:

```js
`Cashback Given,-${(data.cashbackTotal ?? 0).toFixed(2)}`,
```

Add it after `Cash Sales` line and before `Expected in Till`.

**Step 4: Commit**

```bash
git add src/lib/zReport.js src/components/reports/ZReportModal.jsx
git commit -m "feat: include cashback in Z report data and display"
```

---

## Task 7: Edit Tabs — Database Migration

**Files:**
- Create: `supabase/migrations/20260402_tab_adjustments.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/20260402_tab_adjustments.sql
create table tab_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  amount numeric(10,2) not null,  -- negative = reduction, positive = addition
  reason text not null,
  staff_id uuid references members(id),
  created_at timestamptz default now()
);
```

**Step 2: Run migration in Supabase SQL Editor**

**Step 3: Commit**

```bash
git add supabase/migrations/20260402_tab_adjustments.sql
git commit -m "feat: add tab_adjustments migration"
```

---

## Task 8: Edit Tabs — Lib Functions

**Files:**
- Modify: `src/lib/tabs.js`
- Create: `src/lib/tabs.test.js` (new file, tabs has no tests yet)

**Step 1: Write failing tests**

Create `src/lib/tabs.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from './supabase'
import { adjustTabBalance, removeOrderFromTab } from './tabs'

beforeEach(() => vi.clearAllMocks())

describe('adjustTabBalance', () => {
  it('inserts a tab_adjustments row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const select = vi.fn().mockReturnThis()
    const eq = vi.fn().mockReturnThis()
    const update = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { tab_balance: 10 }, error: null })

    supabase.from.mockImplementation((table) => {
      if (table === 'tab_adjustments') return { insert }
      if (table === 'members') return { select, eq, single, update }
      return {}
    })

    await adjustTabBalance('member-1', -5, 'wrote off error', 'staff-1')

    expect(insert).toHaveBeenCalledWith({
      member_id: 'member-1',
      amount: -5,
      reason: 'wrote off error',
      staff_id: 'staff-1',
    })
  })

  it('throws if adjustment insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    supabase.from.mockImplementation(() => ({ insert }))

    await expect(adjustTabBalance('m1', -5, 'reason', 's1')).rejects.toThrow('db error')
  })
})

describe('removeOrderFromTab', () => {
  it('sets payment_method to removed and deducts from tab_balance', async () => {
    const orderUpdate = vi.fn().mockReturnThis()
    const orderEq = vi.fn().mockResolvedValue({ error: null })
    const memberSelect = vi.fn().mockReturnThis()
    const memberEq1 = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { tab_balance: 20 }, error: null })
    const memberUpdate = vi.fn().mockReturnThis()
    const memberEq2 = vi.fn().mockResolvedValue({ error: null })

    supabase.from.mockImplementation((table) => {
      if (table === 'orders') return { update: orderUpdate, eq: orderEq }
      if (table === 'members') return {
        select: memberSelect,
        eq: memberEq1,
        single,
        update: memberUpdate,
      }
      return {}
    })

    await removeOrderFromTab('order-1', 'member-1', 15.50)

    expect(orderUpdate).toHaveBeenCalledWith({ payment_method: 'removed' })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/tabs.test.js
```

Expected: FAIL — functions not exported yet.

**Step 3: Add functions to tabs.js**

Add to the bottom of `src/lib/tabs.js`:

```js
export async function adjustTabBalance(member_id, amount, reason, staff_id) {
  const { error: adjError } = await supabase
    .from('tab_adjustments')
    .insert({ member_id, amount, reason, staff_id })
  if (adjError) throw adjError

  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Number(member.tab_balance) + amount
  const { error: updateError } = await supabase
    .from('members')
    .update({ tab_balance: Math.max(0, newBalance) })
    .eq('id', member_id)
  if (updateError) throw updateError
}

export async function removeOrderFromTab(order_id, member_id, order_total) {
  const { error: orderError } = await supabase
    .from('orders')
    .update({ payment_method: 'removed' })
    .eq('id', order_id)
  if (orderError) throw orderError

  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Math.max(0, Number(member.tab_balance) - order_total)
  const { error: updateError } = await supabase
    .from('members')
    .update({ tab_balance: newBalance })
    .eq('id', member_id)
  if (updateError) throw updateError
}
```

**Step 4: Run test to verify it passes**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/tabs.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/tabs.js src/lib/tabs.test.js
git commit -m "feat: add adjustTabBalance and removeOrderFromTab to tabs lib"
```

---

## Task 9: Edit Tabs — AdjustTabModal Component

**Files:**
- Create: `src/components/members/AdjustTabModal.jsx`

**Step 1: Write the implementation**

```jsx
import { useState, useRef, useId } from 'react'
import { X } from '../../lib/icons'
import { adjustTabBalance } from '../../lib/tabs'
import { useSessionStore } from '../../stores/sessionStore'

export default function AdjustTabModal({ member, onClose, onAdjusted }) {
  const titleId = useId()
  const overlayRef = useRef(null)
  const { activeStaff } = useSessionStore()

  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('subtract') // 'add' | 'subtract'
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current && !saving) onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    if (!reason.trim()) { setError('Reason is required'); return }
    const signed = direction === 'subtract' ? -val : val
    setSaving(true)
    setError(null)
    try {
      await adjustTabBalance(member.id, signed, reason.trim(), activeStaff?.id)
      onAdjusted(signed)
    } catch (err) {
      setError(err.message ?? 'Failed to adjust balance')
      setSaving(false)
    }
  }

  const inputCls = "bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full min-h-[44px]"

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Adjust Tab — {member.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          <p className="text-slate-400 text-sm">
            Current balance: <span className="text-white font-bold">£{Number(member.tab_balance).toFixed(2)}</span>
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-slate-300 text-sm">Adjustment type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirection('subtract')}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                  ${direction === 'subtract' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                aria-pressed={direction === 'subtract'}
              >
                Reduce (−)
              </button>
              <button
                type="button"
                onClick={() => setDirection('add')}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                  ${direction === 'add' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                aria-pressed={direction === 'add'}
              >
                Add (+)
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="adjust-amount" className="text-slate-300 text-sm">Amount (£)</label>
            <input
              id="adjust-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
              className={inputCls}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="adjust-reason" className="text-slate-300 text-sm">Reason <span aria-hidden="true">*</span></label>
            <input
              id="adjust-reason"
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Corrected error, wrote off £5"
              className={inputCls}
              required
            />
          </div>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-sm cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/members/AdjustTabModal.jsx
git commit -m "feat: add AdjustTabModal component"
```

---

## Task 10: Edit Tabs — TabsPage UI (Adjust + Remove Order)

**Files:**
- Modify: `src/pages/TabsPage.jsx`
- Modify: `src/pages/TabsPage.test.jsx`

**Step 1: Write failing tests**

Add to `src/pages/TabsPage.test.jsx`:

```js
// At top, update the mocks section — add tabs lib functions
vi.mock('../lib/tabs', () => ({
  fetchOpenTabs: vi.fn(),
  fetchTabOrders: vi.fn(),
  adjustTabBalance: vi.fn(),
  removeOrderFromTab: vi.fn(),
}))

// Add mock for AdjustTabModal
vi.mock('../components/members/AdjustTabModal', () => ({
  default: ({ member, onClose, onAdjusted }) => (
    <div role="dialog" aria-label="adjust-tab">
      <span>Adjust {member.name}</span>
      <button onClick={() => onAdjusted(-5)}>Confirm Adjust</button>
      <button onClick={onClose}>Cancel Adjust</button>
    </div>
  ),
}))
```

Add these test cases to the `describe('TabsPage')` block:

```js
it('shows an Adjust button in expanded row', async () => {
  render(<TabsPage />)
  await waitFor(() => screen.getByText('Alice'))
  fireEvent.click(screen.getByText('Alice'))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /adjust/i })).toBeInTheDocument()
  })
})

it('opens AdjustTabModal when Adjust is clicked', async () => {
  render(<TabsPage />)
  await waitFor(() => screen.getByText('Alice'))
  fireEvent.click(screen.getByText('Alice'))
  await waitFor(() => screen.getByRole('button', { name: /adjust/i }))
  fireEvent.click(screen.getByRole('button', { name: /adjust/i }))
  expect(screen.getByLabelText('adjust-tab')).toBeInTheDocument()
})

it('shows a Remove button for each order in expanded row', async () => {
  render(<TabsPage />)
  await waitFor(() => screen.getByText('Alice'))
  fireEvent.click(screen.getByText('Alice'))
  await waitFor(() => screen.getByText('Guinness'))
  expect(screen.getByRole('button', { name: /remove order/i })).toBeInTheDocument()
})
```

**Step 2: Run tests to verify they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/pages/TabsPage.test.jsx
```

Expected: new tests FAIL.

**Step 3: Update TabsPage.jsx**

Add imports at the top:

```js
import AdjustTabModal from '../components/members/AdjustTabModal'
import { removeOrderFromTab } from '../lib/tabs'
```

Add state (alongside existing `settlingMember`):

```js
const [adjustingMember, setAdjustingMember] = useState(null)
const [removingOrderId, setRemovingOrderId] = useState(null) // order id pending removal confirm
```

Add `handleAdjusted` function alongside `handleSettled`:

```js
function handleAdjusted(member, delta) {
  setAdjustingMember(null)
  setTabs(prev => prev.map(m =>
    m.id === member.id
      ? { ...m, tab_balance: Math.max(0, Number(m.tab_balance) + delta) }
      : m
  ).filter(m => Number(m.tab_balance) > 0))
}
```

Add `handleRemoveOrder` function:

```js
async function handleRemoveOrder(order, member) {
  setRemovingOrderId(order.id)
  try {
    await removeOrderFromTab(order.id, member.id, order.total_amount)
    // Remove order from local expanded state
    setExpandedOrders(prev => ({
      ...prev,
      [member.id]: prev[member.id].filter(o => o.id !== order.id),
    }))
    // Deduct from local tab balance
    setTabs(prev => prev.map(m =>
      m.id === member.id
        ? { ...m, tab_balance: Math.max(0, Number(m.tab_balance) - order.total_amount) }
        : m
    ).filter(m => Number(m.tab_balance) > 0))
  } catch (err) {
    console.error('Failed to remove order:', err)
  } finally {
    setRemovingOrderId(null)
  }
}
```

In the tab row JSX, add an **Adjust** button alongside the existing **Settle** button:

```jsx
<button
  onClick={() => setAdjustingMember(member)}
  aria-label={`Adjust tab for ${member.name}`}
  className="shrink-0 px-3 min-h-[36px] rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
>
  Adjust
</button>
```

In the expanded order breakdown, add a **Remove** button to each order:

```jsx
<div key={order.id} className="bg-slate-800 rounded-xl p-3">
  <div className="flex items-center justify-between mb-2">
    <p className="text-slate-400 text-xs">
      {new Date(order.created_at).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })}
      <span className="text-white font-bold ml-2">£{Number(order.total_amount).toFixed(2)}</span>
    </p>
    {removingOrderId === order.id ? (
      <span className="text-slate-500 text-xs">Removing…</span>
    ) : (
      <button
        onClick={() => handleRemoveOrder(order, member)}
        aria-label="Remove order from tab"
        className="text-red-400 hover:text-red-300 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
      >
        Remove
      </button>
    )}
  </div>
  {/* existing order_items list */}
```

Add the `AdjustTabModal` at the bottom alongside the existing `SettleTabModal`:

```jsx
{adjustingMember && (
  <AdjustTabModal
    member={adjustingMember}
    onClose={() => setAdjustingMember(null)}
    onAdjusted={(delta) => handleAdjusted(adjustingMember, delta)}
  />
)}
```

**Step 4: Run tests to verify they pass**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/pages/TabsPage.test.jsx
```

Expected: all PASS

**Step 5: Commit**

```bash
git add src/pages/TabsPage.jsx src/pages/TabsPage.test.jsx src/components/members/AdjustTabModal.jsx
git commit -m "feat: add tab adjustment and order removal to TabsPage"
```

---

## Task 11: Partial Tab Payment — Lib Change

**Files:**
- Modify: `src/lib/members.js`

**Step 1: Write a failing test**

Create `src/lib/members.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))
vi.mock('./db', () => ({ db: { members: { put: vi.fn() } } }))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { settleTab } from './members'

beforeEach(() => vi.clearAllMocks())

describe('settleTab', () => {
  function mockMember(balance) {
    const select = vi.fn().mockReturnThis()
    const eq = vi.fn().mockReturnThis()
    const single = vi.fn().mockResolvedValue({ data: { tab_balance: balance }, error: null })
    const update = vi.fn().mockReturnThis()
    const eqUpdate = vi.fn().mockResolvedValue({ error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockImplementation((table) => {
      if (table === 'members') return { select, eq, single, update: () => ({ eq: eqUpdate }) }
      if (table === 'orders') return { insert }
      return {}
    })
    return { select, eq, single, update, eqUpdate, insert }
  }

  it('zeroes the balance when full amount is paid', async () => {
    const { eqUpdate } = mockMember(15.50)
    await settleTab('member-1', 15.50, 'cash')
    // update called with tab_balance: 0
    expect(eqUpdate).toHaveBeenCalledWith('id', 'member-1')
  })

  it('reduces the balance by the partial amount when partial payment made', async () => {
    mockMember(15.50)
    // Should not throw
    await expect(settleTab('member-1', 10.00, 'card')).resolves.not.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/members.test.js
```

Expected: FAIL (current `settleTab` always sets `tab_balance: 0`, ignoring amount)

**Step 3: Update settleTab in members.js**

Replace the existing `settleTab` function (lines 89-103):

```js
export async function settleTab(member_id, amount, payment_method) {
  // Re-fetch current balance to avoid stale-read overwrite
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Math.max(0, Number(member.tab_balance) - amount)
  const { error } = await supabase
    .from('members')
    .update({ tab_balance: newBalance })
    .eq('id', member_id)
  if (error) throw error

  await supabase.from('orders').insert({
    member_id,
    payment_method,
    total_amount: amount,
    status: 'paid',
    till_id: 'till-1',
  })
}
```

**Step 4: Run test to verify it passes**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run src/lib/members.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/members.js src/lib/members.test.js
git commit -m "feat: settleTab now supports partial payment amount"
```

---

## Task 12: Partial Tab Payment — SettleTabModal UI

**Files:**
- Modify: `src/components/members/SettleTabModal.jsx`

**Step 1: Add amount state and input**

In `SettleTabModal.jsx`, add state after the existing `error` state:

```js
const [amount, setAmount] = useState(Number(member.tab_balance).toFixed(2))
```

Add a validation check at the top of `handleSettle`:

```js
async function handleSettle(paymentMethod) {
  const val = parseFloat(amount)
  if (!val || val <= 0) { setError('Enter a valid amount'); return }
  if (val > Number(member.tab_balance)) { setError('Amount exceeds tab balance'); return }
  setSettling(true)
  setError(null)
  try {
    await settleTab(member.id, val, paymentMethod)
    onSettled()
  } catch (err) {
    setError(err.message ?? 'Failed to settle tab. Please try again.')
    setSettling(false)
  }
}
```

In the JSX body, add the amount input between the balance display and the error alert:

```jsx
<div className="flex flex-col gap-1">
  <label htmlFor="settle-amount" className="text-slate-400 text-xs text-center">
    Amount to pay (£)
  </label>
  <input
    id="settle-amount"
    type="number"
    min="0.01"
    step="0.01"
    max={Number(member.tab_balance)}
    value={amount}
    onChange={e => setAmount(e.target.value)}
    className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-center text-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
  />
</div>
```

**Step 2: Verify manually**

Open the Tabs page, click Settle on a member with a tab balance. Confirm:
- Amount input pre-fills with full balance
- You can change it to a lower amount
- Settling with partial amount reduces the balance (member stays on list with remaining balance)
- Settling with full amount removes the member from the list

**Step 3: Commit**

```bash
git add src/components/members/SettleTabModal.jsx
git commit -m "feat: add partial payment amount input to SettleTabModal"
```

---

## Task 13: Run Full Test Suite

**Step 1: Run all tests**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npx vitest run
```

Expected: all tests PASS

**Step 2: Fix any failures before proceeding**

If any tests fail, fix them before the next step.

**Step 3: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: resolve any test failures from feature integration"
```
