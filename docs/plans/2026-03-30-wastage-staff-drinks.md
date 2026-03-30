# Wastage & Staff Drinks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add wastage and staff drink logging to the till, with both appearing as lines on the Z report.

**Architecture:** Two quick-log modals on TillPage write to `stock_movements`. `fetchZReportData` aggregates them by date. `ZReportModal` and the `send-z-report` edge function display the new sections.

**Tech Stack:** React, Vitest + @testing-library/react, Supabase (PostgreSQL + Edge Functions), Tailwind CSS dark theme.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260330_stock_movements_staff_drink.sql`

**Step 1: Create the migration file**

```sql
-- supabase/migrations/20260330_stock_movements_staff_drink.sql
alter table stock_movements add column member_id uuid references members(id);
alter table stock_movements drop constraint stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','restock','wastage','spillage','adjustment','staff_drink'));
```

**Step 2: Apply it in the Supabase SQL Editor**

Paste and run the SQL above in the Supabase dashboard SQL editor for project `sqpokcnoefhfmcvdttqu`.

**Step 3: Commit**

```bash
git add supabase/migrations/20260330_stock_movements_staff_drink.sql
git commit -m "feat: add member_id and staff_drink type to stock_movements"
```

---

### Task 2: Data layer — stockMovements.js

**Files:**
- Create: `src/lib/stockMovements.js`
- Create: `src/lib/stockMovements.test.js`

**Step 1: Write the failing tests**

```js
// src/lib/stockMovements.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from './supabase'
import {
  logWastage,
  logStaffDrink,
  fetchWastageForDate,
  fetchStaffDrinksForDate,
} from './stockMovements'

beforeEach(() => vi.clearAllMocks())

describe('logWastage', () => {
  it('inserts a wastage row', async () => {
    supabase.from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    await logWastage('prod-1', 4, 'till-1')
    expect(supabase.from).toHaveBeenCalledWith('stock_movements')
  })

  it('throws if insert fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    await expect(logWastage('prod-1', 4, 'till-1')).rejects.toThrow('DB error')
  })
})

describe('logStaffDrink', () => {
  it('inserts a staff_drink row with member_id', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert: insertMock })
    await logStaffDrink('prod-1', 1, 'member-1', 'till-1')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff_drink', member_id: 'member-1' })
    )
  })

  it('throws if insert fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    await expect(logStaffDrink('prod-1', 1, 'member-1', 'till-1')).rejects.toThrow('DB error')
  })
})

describe('fetchWastageForDate', () => {
  it('returns wastage rows with name and value', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({
        data: [{ quantity: 4, products: { name: 'Guinness', standard_price: 7.40 } }],
        error: null,
      }),
    })
    const result = await fetchWastageForDate('2026-03-30')
    expect(result).toEqual([{ name: 'Guinness', quantity: 4, value: 29.60 }])
  })

  it('returns empty array when no wastage', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const result = await fetchWastageForDate('2026-03-30')
    expect(result).toEqual([])
  })
})

describe('fetchStaffDrinksForDate', () => {
  it('groups staff drinks by member', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({
        data: [
          { quantity: 1, member_id: 'mem-1', products: { name: 'Guinness', standard_price: 7.40 }, members: { name: 'Dave' } },
          { quantity: 1, member_id: 'mem-1', products: { name: 'Carlsberg', standard_price: 6.00 }, members: { name: 'Dave' } },
        ],
        error: null,
      }),
    })
    const result = await fetchStaffDrinksForDate('2026-03-30')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Dave', items: 2, value: 13.40 })
  })

  it('returns empty array when no staff drinks', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const result = await fetchStaffDrinksForDate('2026-03-30')
    expect(result).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test -- --run src/lib/stockMovements.test.js
```

Expected: FAIL — "stockMovements not found"

**Step 3: Implement stockMovements.js**

```js
// src/lib/stockMovements.js
import { supabase } from './supabase'

export async function logWastage(product_id, quantity, till_id = 'till-1') {
  const { error } = await supabase
    .from('stock_movements')
    .insert({ product_id, quantity, type: 'wastage', till_id })
  if (error) throw error
}

export async function logStaffDrink(product_id, quantity, member_id, till_id = 'till-1') {
  const { error } = await supabase
    .from('stock_movements')
    .insert({ product_id, quantity, type: 'staff_drink', member_id, till_id })
  if (error) throw error
}

export async function fetchWastageForDate(date) {
  const from = `${date}T00:00:00`
  const to = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('stock_movements')
    .select('quantity, products(name, standard_price)')
    .eq('type', 'wastage')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  return (data ?? []).map(r => ({
    name: r.products?.name ?? 'Unknown',
    quantity: r.quantity,
    value: r.quantity * (r.products?.standard_price ?? 0),
  }))
}

export async function fetchStaffDrinksForDate(date) {
  const from = `${date}T00:00:00`
  const to = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('stock_movements')
    .select('quantity, member_id, products(name, standard_price), members(name)')
    .eq('type', 'staff_drink')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  const byMember = {}
  ;(data ?? []).forEach(r => {
    const key = r.member_id ?? 'unknown'
    const memberName = r.members?.name ?? 'Unknown'
    const value = r.quantity * (r.products?.standard_price ?? 0)
    if (!byMember[key]) byMember[key] = { name: memberName, items: 0, value: 0 }
    byMember[key].items += r.quantity
    byMember[key].value += value
  })
  return Object.values(byMember)
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/lib/stockMovements.test.js
```

Expected: 6 tests passing

**Step 5: Commit**

```bash
git add src/lib/stockMovements.js src/lib/stockMovements.test.js
git commit -m "feat: add stockMovements data layer for wastage and staff drinks"
```

---

### Task 3: WastageModal component

**Files:**
- Create: `src/components/till/WastageModal.jsx`
- Create: `src/components/till/WastageModal.test.jsx`

**Step 1: Write the failing tests**

```jsx
// src/components/till/WastageModal.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WastageModal from './WastageModal'

vi.mock('../../lib/stockMovements', () => ({
  logWastage: vi.fn(),
}))

import { logWastage } from '../../lib/stockMovements'

const mockProducts = [
  { id: 'p1', name: 'Guinness', category: 'draught' },
  { id: 'p2', name: 'Carlsberg', category: 'draught' },
  { id: 'p3', name: 'Corona', category: 'bottle' },
]

beforeEach(() => vi.clearAllMocks())

describe('WastageModal', () => {
  it('renders with role dialog', () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('only shows draught products in dropdown', () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Guinness' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Carlsberg' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Corona' })).not.toBeInTheDocument()
  })

  it('calls logWastage with correct args on submit', async () => {
    logWastage.mockResolvedValue()
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(logWastage).toHaveBeenCalledWith('p1', 4)
    })
  })

  it('calls onSaved after successful save', async () => {
    logWastage.mockResolvedValue()
    const onSaved = vi.fn()
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('shows error when quantity is empty', async () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/valid quantity/i)).toBeInTheDocument()
    })
  })

  it('shows error when logWastage throws', async () => {
    logWastage.mockRejectedValue(new Error('DB error'))
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/DB error/i)).toBeInTheDocument())
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<WastageModal products={mockProducts} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/components/till/WastageModal.test.jsx
```

Expected: FAIL — "WastageModal not found"

**Step 3: Implement WastageModal.jsx**

```jsx
// src/components/till/WastageModal.jsx
import { useState } from 'react'
import { X } from '../../lib/icons'
import { logWastage } from '../../lib/stockMovements'

export default function WastageModal({ products, onClose, onSaved }) {
  const draughtProducts = products.filter(p => p.category === 'draught')
  const [productId, setProductId] = useState(draughtProducts[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return }
    setSaving(true)
    setError(null)
    try {
      await logWastage(productId, qty)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to log wastage')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record Wastage"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Record Wastage</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="wastage-product" className="text-slate-300 text-sm">Product</label>
            <select
              id="wastage-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {draughtProducts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="wastage-quantity" className="text-slate-300 text-sm">Quantity (pints)</label>
            <input
              id="wastage-quantity"
              type="number"
              min="0.1"
              step="0.1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="e.g. 4"
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
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
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/till/WastageModal.test.jsx
```

Expected: 6 tests passing

**Step 5: Commit**

```bash
git add src/components/till/WastageModal.jsx src/components/till/WastageModal.test.jsx
git commit -m "feat: add WastageModal component"
```

---

### Task 4: StaffDrinkModal component

**Files:**
- Create: `src/components/till/StaffDrinkModal.jsx`
- Create: `src/components/till/StaffDrinkModal.test.jsx`

**Step 1: Write the failing tests**

```jsx
// src/components/till/StaffDrinkModal.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StaffDrinkModal from './StaffDrinkModal'

vi.mock('../../lib/stockMovements', () => ({
  logStaffDrink: vi.fn(),
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn(() => ({ activeStaff: { id: 'staff-1', name: 'Dave' } })),
}))

import { logStaffDrink } from '../../lib/stockMovements'

const mockProducts = [
  { id: 'p1', name: 'Guinness', category: 'draught' },
  { id: 'p2', name: 'Corona', category: 'bottle' },
]

beforeEach(() => vi.clearAllMocks())

describe('StaffDrinkModal', () => {
  it('renders with role dialog', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows the active staff member name', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Dave')).toBeInTheDocument()
  })

  it('shows all products in dropdown', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Guinness' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Corona' })).toBeInTheDocument()
  })

  it('defaults quantity to 1', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(1)
  })

  it('calls logStaffDrink with correct args on submit', async () => {
    logStaffDrink.mockResolvedValue()
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => {
      expect(logStaffDrink).toHaveBeenCalledWith('p1', 1, 'staff-1')
    })
  })

  it('calls onSaved after successful save', async () => {
    logStaffDrink.mockResolvedValue()
    const onSaved = vi.fn()
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('shows error when logStaffDrink throws', async () => {
    logStaffDrink.mockRejectedValue(new Error('DB error'))
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => expect(screen.getByText(/DB error/i)).toBeInTheDocument())
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<StaffDrinkModal products={mockProducts} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/components/till/StaffDrinkModal.test.jsx
```

Expected: FAIL — "StaffDrinkModal not found"

**Step 3: Implement StaffDrinkModal.jsx**

```jsx
// src/components/till/StaffDrinkModal.jsx
import { useState } from 'react'
import { X } from '../../lib/icons'
import { logStaffDrink } from '../../lib/stockMovements'
import { useSessionStore } from '../../stores/sessionStore'

export default function StaffDrinkModal({ products, onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return }
    setSaving(true)
    setError(null)
    try {
      await logStaffDrink(productId, qty, activeStaff.id)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to log staff drink')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Staff Drink"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Staff Drink</h2>
            <p className="text-slate-400 text-sm">{activeStaff?.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-drink-product" className="text-slate-300 text-sm">Product</label>
            <select
              id="staff-drink-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-drink-quantity" className="text-slate-300 text-sm">Quantity</label>
            <input
              id="staff-drink-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
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
              {saving ? 'Saving…' : 'Log Drink'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/till/StaffDrinkModal.test.jsx
```

Expected: 7 tests passing

**Step 5: Commit**

```bash
git add src/components/till/StaffDrinkModal.jsx src/components/till/StaffDrinkModal.test.jsx
git commit -m "feat: add StaffDrinkModal component"
```

---

### Task 5: Wire modals into TillPage

**Files:**
- Modify: `src/pages/TillPage.jsx`

**Step 1: Add imports at the top of TillPage.jsx**

After the existing imports, add:

```js
import WastageModal from '../components/till/WastageModal'
import StaffDrinkModal from '../components/till/StaffDrinkModal'
```

**Step 2: Add modal state inside the TillPage component**

After `const { orderItems, activeMember, clearOrder, loadPromos } = useTillStore()`, add:

```js
const [showWastage, setShowWastage] = useState(false)
const [showStaffDrink, setShowStaffDrink] = useState(false)
```

**Step 3: Add buttons and modals to the JSX**

In the returned JSX, replace:

```jsx
          {loading
            ? <div className="text-slate-400 text-sm">Loading products...</div>
            : filtered.length === 0
              ? <div className="text-slate-400 text-sm">No products in this category</div>
              : <ProductGrid products={filtered} />}
```

with:

```jsx
          {loading
            ? <div className="text-slate-400 text-sm">Loading products...</div>
            : filtered.length === 0
              ? <div className="text-slate-400 text-sm">No products in this category</div>
              : <ProductGrid products={filtered} />}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowWastage(true)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Record Wastage
            </button>
            <button
              onClick={() => setShowStaffDrink(true)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Staff Drink
            </button>
          </div>
          {showWastage && (
            <WastageModal
              products={products}
              onClose={() => setShowWastage(false)}
              onSaved={() => setShowWastage(false)}
            />
          )}
          {showStaffDrink && (
            <StaffDrinkModal
              products={products}
              onClose={() => setShowStaffDrink(false)}
              onSaved={() => setShowStaffDrink(false)}
            />
          )}
```

**Step 4: Run the full test suite**

```bash
npm test -- --run
```

Expected: all tests passing

**Step 5: Commit**

```bash
git add src/pages/TillPage.jsx
git commit -m "feat: add Wastage and Staff Drink buttons to TillPage"
```

---

### Task 6: Update fetchZReportData to include wastage and staff drinks

**Files:**
- Modify: `src/lib/zReport.js`
- Modify: `src/lib/zReport.test.js`

**Step 1: Read the existing zReport.test.js**

Check what the current tests look like to understand what needs adding.

**Step 2: Add tests for wastage and staff drinks in zReport.test.js**

In the existing test file, the mock for `supabase.from` needs to handle multiple table names. Find the mock setup and extend it to also return data for `stock_movements`. Add these tests after the existing ones:

```js
// Add to the imports at the top
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'

// Mock stockMovements
vi.mock('./stockMovements', () => ({
  fetchWastageForDate: vi.fn().mockResolvedValue([]),
  fetchStaffDrinksForDate: vi.fn().mockResolvedValue([]),
}))

// Add these tests
describe('fetchZReportData — wastage and staff drinks', () => {
  it('includes wastage in the result', async () => {
    fetchWastageForDate.mockResolvedValue([{ name: 'Guinness', quantity: 4, value: 29.60 }])
    const result = await fetchZReportData('2026-03-30')
    expect(result.wastage).toEqual([{ name: 'Guinness', quantity: 4, value: 29.60 }])
  })

  it('includes staffDrinks in the result', async () => {
    fetchStaffDrinksForDate.mockResolvedValue([{ name: 'Dave', items: 2, value: 13.40 }])
    const result = await fetchZReportData('2026-03-30')
    expect(result.staffDrinks).toEqual([{ name: 'Dave', items: 2, value: 13.40 }])
  })

  it('returns empty arrays when no wastage or staff drinks', async () => {
    const result = await fetchZReportData('2026-03-30')
    expect(result.wastage).toEqual([])
    expect(result.staffDrinks).toEqual([])
  })
})
```

**Step 3: Run tests to verify new ones fail**

```bash
npm test -- --run src/lib/zReport.test.js
```

Expected: new tests FAIL — "wastage is undefined"

**Step 4: Update fetchZReportData in zReport.js**

At the top of the file, add the import:

```js
import { fetchWastageForDate, fetchStaffDrinksForDate } from './stockMovements'
```

At the bottom of the `fetchZReportData` function, before the `return`, add:

```js
  const [wastage, staffDrinks] = await Promise.all([
    fetchWastageForDate(date),
    fetchStaffDrinksForDate(date),
  ])

  return { salesSummary, topProducts, wastage, staffDrinks }
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/lib/zReport.test.js
```

Expected: all tests passing

**Step 6: Commit**

```bash
git add src/lib/zReport.js src/lib/zReport.test.js
git commit -m "feat: include wastage and staff drinks in fetchZReportData"
```

---

### Task 7: Update ZReportModal to display wastage and staff drinks

**Files:**
- Modify: `src/components/reports/ZReportModal.jsx`
- Modify: `src/components/reports/ZReportModal.test.jsx`

**Step 1: Add tests in ZReportModal.test.jsx**

In the `REPORT_DATA` constant, add:

```js
  wastage: [{ name: 'Guinness', quantity: 4, value: 29.60 }],
  staffDrinks: [{ name: 'Dave', items: 2, value: 13.40 }],
```

Add these tests in a new describe block:

```js
describe('ZReportModal — Wastage & Staff Drinks', () => {
  it('shows wastage section heading', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/wastage/i)).toBeInTheDocument()
    })
  })

  it('shows wastage product and value', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('£29.60')).toBeInTheDocument()
    })
  })

  it('shows staff drinks section heading', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/staff drinks/i)).toBeInTheDocument()
    })
  })

  it('shows staff member and value', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Dave')).toBeInTheDocument()
      expect(screen.getByText('£13.40')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/components/reports/ZReportModal.test.jsx
```

Expected: new tests FAIL

**Step 3: Add wastage section to ZReportModal.jsx**

After the closing `</section>` of the "Top Products" section (around line 246), add:

```jsx
              {/* Section 4: Wastage */}
              {data.wastage?.length > 0 && (
                <section aria-labelledby="z-wastage-heading">
                  <h3
                    id="z-wastage-heading"
                    className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                  >
                    Wastage
                  </h3>
                  <div className="bg-slate-800/60 rounded-xl p-4 space-y-2">
                    {data.wastage.map((w, i) => (
                      <Row key={i} label={`${w.name} ×${w.quantity}`}>
                        <span className="text-red-400 text-sm tabular-nums">{fmt(w.value)}</span>
                      </Row>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 5: Staff Drinks */}
              {data.staffDrinks?.length > 0 && (
                <section aria-labelledby="z-staff-heading">
                  <h3
                    id="z-staff-heading"
                    className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                  >
                    Staff Drinks
                  </h3>
                  <div className="bg-slate-800/60 rounded-xl p-4 space-y-2">
                    {data.staffDrinks.map((s, i) => (
                      <Row key={i} label={`${s.name} (${s.items} item${s.items !== 1 ? 's' : ''})`}>
                        <span className="text-orange-400 text-sm tabular-nums">{fmt(s.value)}</span>
                      </Row>
                    ))}
                  </div>
                </section>
              )}
```

Also update `handleExportCSV` to include wastage and staff drinks in the CSV. After the cash reconciliation lines, add:

```js
    if (data.wastage?.length > 0) {
      lines.push('', 'Wastage', 'Product,Quantity,Value')
      data.wastage.forEach(w => lines.push(`${w.name},${w.quantity},${w.value.toFixed(2)}`))
    }
    if (data.staffDrinks?.length > 0) {
      lines.push('', 'Staff Drinks', 'Staff,Items,Value')
      data.staffDrinks.forEach(s => lines.push(`${s.name},${s.items},${s.value.toFixed(2)}`))
    }
```

Also pass wastage and staff drinks through `handleCloseDay` to the edge function body:

```js
      const { error: emailErr } = await supabase.functions.invoke('send-z-report', {
        body: {
          reportDate: date,
          salesSummary: s,
          topProducts,
          cashReconciliation: reconciliation,
          wastage: data.wastage ?? [],
          staffDrinks: data.staffDrinks ?? [],
        },
      })
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/components/reports/ZReportModal.test.jsx
```

Expected: all tests passing

**Step 5: Commit**

```bash
git add src/components/reports/ZReportModal.jsx src/components/reports/ZReportModal.test.jsx
git commit -m "feat: show wastage and staff drinks in ZReportModal"
```

---

### Task 8: Update send-z-report edge function

**Files:**
- Modify: `supabase/functions/send-z-report/index.ts`

**Step 1: Update the ZReportBody interface**

Add to the interface:

```ts
interface WastageItem {
  name: string
  quantity: number
  value: number
}

interface StaffDrinkSummary {
  name: string
  items: number
  value: number
}

interface ZReportBody {
  reportDate: string
  salesSummary: SalesSummary
  topProducts: TopProduct[]
  cashReconciliation: CashReconciliation
  wastage: WastageItem[]
  staffDrinks: StaffDrinkSummary[]
}
```

**Step 2: Update buildEmailText to include wastage and staff drinks**

In `buildEmailText`, after the cash reconciliation lines, add:

```ts
    if (body.wastage?.length > 0) {
      lines.push('', 'WASTAGE', '-'.repeat(40))
      body.wastage.forEach(w =>
        lines.push(`${w.name.padEnd(20)} ×${w.quantity}  ${fmt(w.value)}`)
      )
    }

    if (body.staffDrinks?.length > 0) {
      lines.push('', 'STAFF DRINKS', '-'.repeat(40))
      body.staffDrinks.forEach(s =>
        lines.push(`${s.name.padEnd(20)} ${s.items} item${s.items !== 1 ? 's' : ''}  ${fmt(s.value)}`)
      )
    }
```

**Step 3: Update validation to not require wastage/staffDrinks (they may be empty)**

The existing validations for `reportDate`, `salesSummary`, `topProducts`, `cashReconciliation` stay as-is. No new required field validation needed — wastage and staffDrinks default to empty arrays.

**Step 4: Deploy the edge function**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npx supabase functions deploy send-z-report --project-ref sqpokcnoefhfmcvdttqu
```

**Step 5: Run the full test suite**

```bash
npm test -- --run
```

Expected: all tests passing

**Step 6: Commit and push**

```bash
git add supabase/functions/send-z-report/index.ts
git commit -m "feat: add wastage and staff drinks to Z report email"
git push origin master
```
