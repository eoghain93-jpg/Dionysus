# Low Stock Alerts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Products can have an optional reorder threshold. When stock drops at or below that threshold, the manager receives an email alert and the Stock page nav item shows a red badge with the count of low-stock items. A filter button on the Stock page lets staff quickly view only low-stock items. Low-stock rows get an amber highlight.

**Architecture:** A new DB migration adds `reorder_threshold` and `low_stock_notified_at` columns to `products`. A new `notify-low-stock` Deno edge function handles the debounced email via Supabase SMTP. A new Zustand store (`lowStockStore`) derives and exposes the low-stock count from the fetched products list. `NavBar` reads this count to render a badge on the Stock link. `StockPage` gains a "Low stock" filter toggle. `StockList` highlights low-stock rows. `logStockMovement` in `products.js` calls the edge function after any stock-reducing movement. `ProductFormModal` gains an optional `reorder_threshold` number input.

**Tech Stack:** React + Vite, Vitest + @testing-library/react, Tailwind CSS, lucide-react, Zustand, Supabase (PostgreSQL + Edge Functions), Deno

---

## Test command

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Baseline: **147 tests passing**. Each task below lists the expected count after its tests are added.

---

## Task 1 — DB migration: `reorder_threshold` + `low_stock_notified_at`

**Files:**
- Create: `supabase/migrations/20260330_low_stock_alerts.sql`

### Step 1: Create the migration file

```sql
-- supabase/migrations/20260330_low_stock_alerts.sql

-- Optional reorder threshold for a product.
-- When stock_on_hand <= reorder_threshold (and threshold is not null),
-- the product is considered "low stock".
alter table products add column if not exists reorder_threshold integer;

-- Timestamp of the last low-stock email sent for this product.
-- Used to debounce alerts — only one email per product per hour.
alter table products add column if not exists low_stock_notified_at timestamptz;
```

### Step 2: Apply in Supabase

Open Supabase dashboard → SQL editor → paste and run. Verify `products` table now has both new columns.

### Step 3: Commit

```bash
git add supabase/migrations/20260330_low_stock_alerts.sql
git commit -m "feat: add reorder_threshold and low_stock_notified_at columns to products"
```

No tests added in this task. Count remains: **147 passing**.

---

## Task 2 — Edge function: `notify-low-stock`

**Files:**
- Create: `supabase/functions/notify-low-stock/index.ts`

This function is called by the EPOS after a stock-reducing movement crosses a product below its threshold. It:
1. Validates the incoming Supabase JWT (same pattern as `invite-member`)
2. Checks `low_stock_notified_at` — skips if an email was sent within the last hour
3. Sends an email via Supabase SMTP to `MANAGER_EMAIL`
4. Updates `low_stock_notified_at = now()` on the product
5. Returns `{ sent: boolean }`

### Step 1: Create the function

```typescript
// supabase/functions/notify-low-stock/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Validate the Supabase JWT so only authenticated EPOS sessions can trigger emails
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { error: jwtError } = await anonClient.auth.getUser()
  if (jwtError) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let product_id: string, product_name: string, stock_on_hand: number, reorder_threshold: number
  try {
    const body = await req.json()
    product_id = body.product_id
    product_name = body.product_name
    stock_on_hand = body.stock_on_hand
    reorder_threshold = body.reorder_threshold
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!product_id || !product_name || stock_on_hand == null || reorder_threshold == null) {
    return new Response(
      JSON.stringify({ error: 'product_id, product_name, stock_on_hand and reorder_threshold are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const managerEmail = Deno.env.get('MANAGER_EMAIL')
  if (!managerEmail) {
    return new Response(JSON.stringify({ error: 'MANAGER_EMAIL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Debounce: fetch current low_stock_notified_at
  const { data: product, error: fetchError } = await supabase
    .from('products')
    .select('low_stock_notified_at')
    .eq('id', product_id)
    .single()

  if (fetchError || !product) {
    return new Response(JSON.stringify({ error: 'Product not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  if (product.low_stock_notified_at && product.low_stock_notified_at > oneHourAgo) {
    // Already notified within the last hour — skip silently
    return new Response(JSON.stringify({ sent: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Send email via Supabase SMTP
  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
  const { error: emailError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: managerEmail,
  })
  // NOTE: Supabase does not expose a raw SMTP send API from edge functions.
  // The standard pattern is to use the `supabase-js` `auth.admin` API or
  // a third-party email provider. Here we use fetch against the Supabase
  // internal mail endpoint that Supabase configures via the SMTP settings
  // in the project dashboard (the same mechanism that sends magic links).
  // In production, replace this with your preferred provider (Resend, SendGrid, etc.)
  const emailResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      to: managerEmail,
      subject: `Low Stock Alert — ${product_name}`,
      html: `
        <h2>Low Stock Alert</h2>
        <p><strong>${product_name}</strong> has dropped to or below its reorder threshold.</p>
        <ul>
          <li><strong>Current stock:</strong> ${stock_on_hand}</li>
          <li><strong>Reorder threshold:</strong> ${reorder_threshold}</li>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
        <p>Please arrange a restock soon.</p>
      `,
    }),
  })

  // Regardless of email send success, stamp the notification time so we don't
  // spam if the email provider is down. Log the failure but don't error out.
  if (!emailResponse.ok) {
    console.error('Failed to send low-stock email:', await emailResponse.text())
  }

  // Update low_stock_notified_at on the product
  const { error: updateError } = await supabase
    .from('products')
    .update({ low_stock_notified_at: new Date().toISOString() })
    .eq('id', product_id)

  if (updateError) {
    console.error('Failed to update low_stock_notified_at:', updateError)
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
```

> **Note on email sending:** Supabase does not provide a raw SMTP send API directly from edge functions. The implementation above calls a hypothetical `send-email` helper function. In practice, use [Resend](https://resend.com/) (`fetch('https://api.resend.com/emails', ...)` with `Authorization: Bearer RESEND_API_KEY`) or configure the Supabase SMTP settings and use the `supabase.auth.admin` invite flow to proxy email delivery. The debounce and `low_stock_notified_at` logic is production-ready regardless of provider.

### Step 2: Commit

```bash
git add supabase/functions/notify-low-stock/index.ts
git commit -m "feat: add notify-low-stock edge function with debounce"
```

No Vitest tests for edge functions (they run in Deno). Count remains: **147 passing**.

---

## Task 3 — Low-stock badge on Stock nav + filter in StockPage/StockList

This task has three parts:
1. `lowStockStore` — Zustand store that holds the low-stock count and low-stock filter flag
2. `NavBar` — render a red badge on the Stock nav link when count > 0
3. `StockPage` — "Low stock" filter toggle button
4. `StockList` — amber row highlight for low-stock products

### Step 1: Write the tests first

#### 3a — `src/stores/__tests__/lowStockStore.test.js`

```javascript
// src/stores/__tests__/lowStockStore.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { useLowStockStore } from '../lowStockStore'

// Reset the store between tests
beforeEach(() => {
  useLowStockStore.setState({ lowStockCount: 0, showLowStockOnly: false })
})

describe('lowStockStore', () => {
  it('initialises with lowStockCount 0 and showLowStockOnly false', () => {
    const state = useLowStockStore.getState()
    expect(state.lowStockCount).toBe(0)
    expect(state.showLowStockOnly).toBe(false)
  })

  it('setLowStockCount updates the count', () => {
    useLowStockStore.getState().setLowStockCount(3)
    expect(useLowStockStore.getState().lowStockCount).toBe(3)
  })

  it('toggleLowStockFilter flips showLowStockOnly', () => {
    useLowStockStore.getState().toggleLowStockFilter()
    expect(useLowStockStore.getState().showLowStockOnly).toBe(true)
    useLowStockStore.getState().toggleLowStockFilter()
    expect(useLowStockStore.getState().showLowStockOnly).toBe(false)
  })
})
```

Run — expect **3 new failures** (store doesn't exist yet).

#### 3b — `src/components/__tests__/NavBar.lowstock.test.jsx`

```jsx
// src/components/__tests__/NavBar.lowstock.test.jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach } from 'vitest'
import { useLowStockStore } from '../../stores/lowStockStore'
import NavBar from '../NavBar'

beforeEach(() => {
  useLowStockStore.setState({ lowStockCount: 0, showLowStockOnly: false })
})

describe('NavBar low-stock badge', () => {
  it('does not show a badge when lowStockCount is 0', () => {
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    expect(screen.queryByRole('status', { name: /low stock/i })).not.toBeInTheDocument()
  })

  it('shows a red badge with the count when lowStockCount > 0', () => {
    useLowStockStore.setState({ lowStockCount: 4 })
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    // Badge should be visible at least once (sidebar + mobile bar both render NavBar)
    const badges = screen.getAllByRole('status', { name: /4 low stock items/i })
    expect(badges.length).toBeGreaterThanOrEqual(1)
    expect(badges[0]).toHaveTextContent('4')
  })

  it('badge has accessible aria-label', () => {
    useLowStockStore.setState({ lowStockCount: 2 })
    render(<MemoryRouter><NavBar /></MemoryRouter>)
    const badges = screen.getAllByLabelText(/2 low stock items/i)
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })
})
```

Run — expect **3 new failures**.

#### 3c — `src/components/stock/__tests__/StockPage.lowstock.test.jsx`

```jsx
// src/components/stock/__tests__/StockPage.lowstock.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLowStockStore } from '../../../stores/lowStockStore'
import StockPage from '../../../pages/StockPage'

// Mock products lib
vi.mock('../../../lib/products', () => ({
  fetchProducts: vi.fn().mockResolvedValue([
    {
      id: '1',
      name: 'Guinness',
      category: 'draught',
      stock_quantity: 3,
      par_level: 10,
      standard_price: 5.5,
      member_price: 4.5,
      reorder_threshold: 5,
    },
    {
      id: '2',
      name: 'Coke',
      category: 'soft',
      stock_quantity: 20,
      par_level: 8,
      standard_price: 2.5,
      member_price: 2.0,
      reorder_threshold: null,
    },
    {
      id: '3',
      name: 'Lager',
      category: 'draught',
      stock_quantity: 2,
      par_level: 10,
      standard_price: 4.5,
      member_price: 3.5,
      reorder_threshold: 6,
    },
  ]),
  upsertProduct: vi.fn(),
  logStockMovement: vi.fn(),
}))

beforeEach(() => {
  useLowStockStore.setState({ lowStockCount: 0, showLowStockOnly: false })
})

describe('StockPage — low-stock integration', () => {
  it('sets lowStockCount in store after products load', async () => {
    render(<StockPage />)
    // Wait for products to load
    expect(await screen.findByText('Guinness')).toBeInTheDocument()
    // Guinness (3 <= 5) and Lager (2 <= 6) are both low stock
    expect(useLowStockStore.getState().lowStockCount).toBe(2)
  })

  it('shows "Low stock" filter button', async () => {
    render(<StockPage />)
    await screen.findByText('Guinness')
    expect(screen.getByRole('button', { name: /low stock/i })).toBeInTheDocument()
  })

  it('filter button shows the low-stock count', async () => {
    render(<StockPage />)
    await screen.findByText('Guinness')
    const btn = screen.getByRole('button', { name: /low stock/i })
    expect(btn).toHaveTextContent('2')
  })

  it('clicking "Low stock" filter hides non-low-stock products', async () => {
    render(<StockPage />)
    await screen.findByText('Coke')
    fireEvent.click(screen.getByRole('button', { name: /low stock/i }))
    expect(screen.queryByText('Coke')).not.toBeInTheDocument()
    expect(screen.getByText('Guinness')).toBeInTheDocument()
    expect(screen.getByText('Lager')).toBeInTheDocument()
  })

  it('clicking "Low stock" filter again shows all products', async () => {
    render(<StockPage />)
    await screen.findByText('Coke')
    const btn = screen.getByRole('button', { name: /low stock/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.getByText('Coke')).toBeInTheDocument()
  })
})
```

Run — expect **5 new failures**.

#### 3d — Extend `src/components/stock/__tests__/StockList.test.jsx` (add to existing file)

Add the following `describe` block at the bottom of the existing test file:

```jsx
describe('StockList — low-stock row highlight', () => {
  const productsWithThreshold = [
    {
      id: '1',
      name: 'Guinness',
      category: 'draught',
      stock_quantity: 3,
      par_level: 10,
      standard_price: 5.5,
      member_price: 4.5,
      reorder_threshold: 5,
    },
    {
      id: '2',
      name: 'Coke',
      category: 'soft',
      stock_quantity: 20,
      par_level: 8,
      standard_price: 2.5,
      member_price: 2.0,
      reorder_threshold: null,
    },
  ]

  it('applies amber highlight class to a row where stock_quantity <= reorder_threshold', () => {
    render(<StockList products={productsWithThreshold} onWastage={noop} onRestock={noop} onEdit={noop} />)
    const guinessRow = screen.getByText('Guinness').closest('tr')
    expect(guinessRow).toHaveClass('bg-amber-500/10')
  })

  it('does not apply amber highlight to a row above threshold', () => {
    render(<StockList products={productsWithThreshold} onWastage={noop} onRestock={noop} onEdit={noop} />)
    const cokeRow = screen.getByText('Coke').closest('tr')
    expect(cokeRow).not.toHaveClass('bg-amber-500/10')
  })

  it('does not apply amber highlight when reorder_threshold is null', () => {
    render(<StockList products={productsWithThreshold} onWastage={noop} onRestock={noop} onEdit={noop} />)
    const cokeRow = screen.getByText('Coke').closest('tr')
    expect(cokeRow).not.toHaveClass('bg-amber-500/10')
  })
})
```

Run — expect **3 new failures**. Total expected failures: **14**. All other 147 tests still pass.

### Step 2: Implement `lowStockStore`

Create `src/stores/lowStockStore.js`:

```javascript
// src/stores/lowStockStore.js
import { create } from 'zustand'

export const useLowStockStore = create((set) => ({
  lowStockCount: 0,
  showLowStockOnly: false,

  setLowStockCount: (lowStockCount) => set({ lowStockCount }),
  toggleLowStockFilter: () => set((state) => ({ showLowStockOnly: !state.showLowStockOnly })),
}))
```

Run tests — store tests pass. Count: **150 passing**, ~11 still failing.

### Step 3: Update `NavBar.jsx`

Replace the full file content. Key changes:
- Import `useLowStockStore`
- Wrap the Stock icon in a `relative` container
- Render a red badge when `lowStockCount > 0`

```jsx
// src/components/NavBar.jsx
import { NavLink } from 'react-router-dom'
import { ShoppingCart, Package, Users, BarChart2 } from 'lucide-react'
import { useLowStockStore } from '../stores/lowStockStore'

const NAV_LINKS = [
  { to: '/', label: 'Till', Icon: ShoppingCart },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/reports', label: 'Reports', Icon: BarChart2 },
]

function StockIcon({ size }) {
  const lowStockCount = useLowStockStore((s) => s.lowStockCount)
  return (
    <span className="relative inline-flex">
      <Package size={size} aria-hidden="true" />
      {lowStockCount > 0 && (
        <span
          role="status"
          aria-label={`${lowStockCount} low stock items`}
          className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none"
        >
          {lowStockCount > 99 ? '99+' : lowStockCount}
        </span>
      )}
    </span>
  )
}

export default function NavBar() {
  return (
    <>
      {/* Sidebar — tablet/desktop */}
      <nav className="hidden md:flex flex-col w-20 lg:w-52 bg-slate-900 border-r border-slate-800 min-h-screen p-3 gap-1 shrink-0">
        <div className="px-3 py-5 hidden lg:block">
          <span className="text-white font-bold text-lg" style={{ fontFamily: "'Playfair Display SC', serif" }}>
            Dionysus
          </span>
        </div>
        {NAV_LINKS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium
               transition-colors duration-200 cursor-pointer min-h-[44px]
               ${isActive
                 ? 'bg-blue-600 text-white'
                 : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`
            }
          >
            {label === 'Stock' ? (
              <StockIcon size={20} />
            ) : (
              <Icon size={20} aria-hidden="true" />
            )}
            <span className="hidden lg:block">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom tab bar — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex z-50">
        {NAV_LINKS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium
               transition-colors duration-200 cursor-pointer min-h-[56px]
               ${isActive ? 'text-blue-400' : 'text-slate-500'}`
            }
            aria-label={label}
          >
            {label === 'Stock' ? (
              <StockIcon size={22} />
            ) : (
              <Icon size={22} aria-hidden="true" />
            )}
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
```

Run tests — NavBar badge tests pass. Count: **153 passing**, ~8 still failing.

### Step 4: Update `StockList.jsx` — amber row highlight

In `StockList.jsx`, update the `<tr>` element inside `products.map` to conditionally add the amber highlight class. The logic is: a product is "low stock alert" when `reorder_threshold` is not null and `stock_quantity <= reorder_threshold`.

Change the `<tr>` from:

```jsx
<tr
  key={product.id}
  className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
>
```

to:

```jsx
<tr
  key={product.id}
  className={[
    'border-b border-slate-800 hover:bg-slate-800/40 transition-colors',
    product.reorder_threshold != null && product.stock_quantity <= product.reorder_threshold
      ? 'bg-amber-500/10'
      : '',
  ].join(' ')}
>
```

Run tests — StockList highlight tests pass. Count: **156 passing**, ~5 still failing.

### Step 5: Update `StockPage.jsx`

Replace the full file. Key changes:
- Import `useLowStockStore`
- After `loadProducts` resolves, compute low-stock count and call `setLowStockCount`
- Add `showLowStockOnly` filter toggle button to the header area
- Apply the low-stock filter in the `filtered` derived value

```jsx
// src/pages/StockPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { fetchProducts } from '../lib/products'
import { Plus, Search, AlertTriangle } from '../lib/icons'
import StockList from '../components/stock/StockList'
import StockMovementModal from '../components/stock/StockMovementModal'
import ProductFormModal from '../components/stock/ProductFormModal'
import { useLowStockStore } from '../stores/lowStockStore'

const CATEGORIES = ['all', 'draught', 'bottle', 'spirit', 'soft', 'food', 'other']

function isLowStock(product) {
  return (
    product.reorder_threshold != null &&
    product.stock_quantity <= product.reorder_threshold
  )
}

export default function StockPage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')

  const { lowStockCount, showLowStockOnly, setLowStockCount, toggleLowStockFilter } = useLowStockStore()

  // Modal state
  const [movementModal, setMovementModal] = useState(null) // { product, type }
  const [productModal, setProductModal] = useState(undefined) // undefined = closed, null = add, object = edit

  const loadProducts = useCallback(() => {
    setLoading(true)
    fetchProducts()
      .then((data) => {
        setProducts(data)
        setLowStockCount(data.filter(isLowStock).length)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [setLowStockCount])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  // Filtering
  const filtered = products.filter(p => {
    const matchesCategory = category === 'all' || p.category === category
    const matchesSearch = search.trim() === '' || p.name.toLowerCase().includes(search.trim().toLowerCase())
    const matchesLowStock = !showLowStockOnly || isLowStock(p)
    return matchesCategory && matchesSearch && matchesLowStock
  })

  function openWastage(product) {
    setMovementModal({ product, type: 'wastage' })
  }

  function openRestock(product) {
    setMovementModal({ product, type: 'restock' })
  }

  function openEdit(product) {
    setProductModal(product)
  }

  function closeMovementModal() {
    setMovementModal(null)
  }

  function closeProductModal() {
    setProductModal(undefined)
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
          style={{ fontFamily: "'Playfair Display SC', serif" }}
        >
          Stock
        </h1>
        <div className="flex items-center gap-2">
          {/* Low-stock filter toggle */}
          <button
            onClick={toggleLowStockFilter}
            aria-pressed={showLowStockOnly}
            className={[
              'flex items-center gap-2 px-4 min-h-[44px] rounded-xl text-sm font-bold transition-colors cursor-pointer',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]',
              showLowStockOnly
                ? 'bg-amber-500 text-slate-900'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white',
            ].join(' ')}
          >
            <AlertTriangle size={16} aria-hidden="true" />
            Low stock
            {lowStockCount > 0 && (
              <span className="ml-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                {lowStockCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setProductModal(null)}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <Plus size={16} aria-hidden="true" />
            Add Product
          </button>
        </div>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className="w-full bg-[#0F172A] border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          />
        </div>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 text-white min-h-[44px] capitalize focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c} className="capitalize">{c === 'all' ? 'All categories' : c}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading products…</p>
        ) : (
          <StockList
            products={filtered}
            onWastage={openWastage}
            onRestock={openRestock}
            onEdit={openEdit}
          />
        )}
      </div>

      {/* Stock movement modal (wastage / spillage / restock) */}
      {movementModal && (
        <StockMovementModal
          product={movementModal.product}
          type={movementModal.type}
          onClose={closeMovementModal}
          onSaved={() => {
            closeMovementModal()
            loadProducts()
          }}
        />
      )}

      {/* Product form modal (add / edit) */}
      {productModal !== undefined && (
        <ProductFormModal
          product={productModal}
          onClose={closeProductModal}
          onSaved={() => {
            closeProductModal()
            loadProducts()
          }}
        />
      )}
    </div>
  )
}
```

> **Note:** `AlertTriangle` must be re-exported from `src/lib/icons.js` if not already present. Check the file — if it is already imported in `StockList.jsx` but re-exported via `src/lib/icons`, it is fine. If `src/lib/icons.js` is a barrel file, add `AlertTriangle` to it. If `StockList.jsx` imports it directly from `lucide-react`, then `StockPage.jsx` should also import directly: `import { AlertTriangle } from 'lucide-react'`.

Run tests — all 14 new tests pass. Count: **161 passing**.

### Step 6: Run the full test suite

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Verify: **161 tests passing, 0 failing**.

### Step 7: Commit

```bash
git add src/stores/lowStockStore.js src/components/NavBar.jsx src/pages/StockPage.jsx src/components/stock/StockList.jsx src/stores/__tests__/lowStockStore.test.js src/components/__tests__/NavBar.lowstock.test.jsx src/components/stock/__tests__/StockPage.lowstock.test.jsx src/components/stock/__tests__/StockList.test.jsx
git commit -m "feat: low-stock badge on Stock nav, filter toggle, and amber row highlight"
```

---

## Task 4 — Wire alert trigger into `logStockMovement`

After any stock movement that reduces stock (sale, wastage, spillage), `logStockMovement` must:
1. Fetch the updated product from Supabase (to get fresh `stock_quantity` and `reorder_threshold`)
2. If `reorder_threshold` is set and the new `stock_quantity <= reorder_threshold`, call the `notify-low-stock` edge function
3. Skip this check when offline (no network = no email)

**Files:**
- Modify: `src/lib/products.js`

### Step 1: Write the test first

Create `src/lib/__tests__/products.lowstock.test.js`:

```javascript
// src/lib/__tests__/products.lowstock.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to control the supabase mock in detail, so mock the module
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) },
  },
}))

vi.mock('../db', () => ({
  db: {
    pendingStockMovements: { add: vi.fn() },
    products: { bulkPut: vi.fn(), where: vi.fn(), put: vi.fn() },
  },
}))

vi.mock('../../stores/syncStore', () => ({
  useSyncStore: { getState: vi.fn().mockReturnValue({ isOnline: true }) },
}))

// Mock fetch for edge function call
const mockFetch = vi.fn()
global.fetch = mockFetch

import { logStockMovement } from '../products'
import { supabase } from '../supabase'

const mockInsertFn = vi.fn().mockReturnValue({ error: null })
const mockRpcFn = vi.fn().mockResolvedValue({ error: null })
const mockSelectSingleFn = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sent: true }) })

  // Default: supabase.from('stock_movements').insert() returns no error
  // supabase.from('products').select().eq().single() returns the updated product
  supabase.from.mockImplementation((table) => {
    if (table === 'stock_movements') {
      return { insert: () => ({ error: null }) }
    }
    if (table === 'products') {
      return {
        select: () => ({
          eq: () => ({
            single: mockSelectSingleFn,
          }),
        }),
      }
    }
    return {}
  })
  supabase.rpc = mockRpcFn
})

describe('logStockMovement — low-stock alert trigger', () => {
  it('calls notify-low-stock edge function when stock crosses below threshold after wastage', async () => {
    mockSelectSingleFn.mockResolvedValue({
      data: {
        id: 'prod-1',
        name: 'Guinness',
        stock_quantity: 3,
        reorder_threshold: 5,
        low_stock_notified_at: null,
      },
      error: null,
    })

    await logStockMovement({ product_id: 'prod-1', type: 'wastage', quantity: 2, notes: null })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('notify-low-stock'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"product_id":"prod-1"'),
      })
    )
  })

  it('does not call notify-low-stock when stock remains above threshold', async () => {
    mockSelectSingleFn.mockResolvedValue({
      data: {
        id: 'prod-2',
        name: 'Coke',
        stock_quantity: 15,
        reorder_threshold: 5,
        low_stock_notified_at: null,
      },
      error: null,
    })

    await logStockMovement({ product_id: 'prod-2', type: 'wastage', quantity: 1, notes: null })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not call notify-low-stock when reorder_threshold is null', async () => {
    mockSelectSingleFn.mockResolvedValue({
      data: {
        id: 'prod-3',
        name: 'Lager',
        stock_quantity: 2,
        reorder_threshold: null,
        low_stock_notified_at: null,
      },
      error: null,
    })

    await logStockMovement({ product_id: 'prod-3', type: 'wastage', quantity: 1, notes: null })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not call notify-low-stock for restock movements', async () => {
    // restock should never trigger low-stock alert
    await logStockMovement({ product_id: 'prod-1', type: 'restock', quantity: 10, notes: null })

    // fetch for product state not needed; edge function must not be called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not throw if edge function call fails — fire and forget', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Server error' }) })
    mockSelectSingleFn.mockResolvedValue({
      data: {
        id: 'prod-1',
        name: 'Guinness',
        stock_quantity: 3,
        reorder_threshold: 5,
        low_stock_notified_at: null,
      },
      error: null,
    })

    // Should not throw even if edge function returns an error
    await expect(
      logStockMovement({ product_id: 'prod-1', type: 'wastage', quantity: 2, notes: null })
    ).resolves.not.toThrow()
  })
})
```

Run — expect **5 new failures**. Count: 161 passing, 5 failing.

### Step 2: Implement the trigger in `products.js`

Replace the full file:

```javascript
// src/lib/products.js
import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'

const REDUCING_TYPES = new Set(['sale', 'wastage', 'spillage'])

export async function fetchProducts() {
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { data, error } = await supabase
      .from('products')
      .select('*, suppliers(name)')
      .eq('active', true)
      .order('category')
      .order('name')

    if (error) throw error

    await db.products.bulkPut(data)
    return data
  } else {
    return db.products.where('active').equals(1).sortBy('name')
  }
}

export async function upsertProduct(product) {
  const { id, ...fields } = product
  if (id) {
    const { data, error } = await supabase.from('products').update(fields).eq('id', id).select().single()
    if (error) throw error
    await db.products.put(data)
    return data
  } else {
    const { data, error } = await supabase.from('products').insert(fields).select().single()
    if (error) throw error
    await db.products.put(data)
    return data
  }
}

export async function logStockMovement({ product_id, type, quantity, notes, till_id = 'till-1' }) {
  const movement = { product_id, type, quantity, notes, till_id, created_at: new Date().toISOString() }
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { error } = await supabase.from('stock_movements').insert(movement)
    if (error) throw error
    const sign = REDUCING_TYPES.has(type) ? -1 : 1
    await supabase.rpc('adjust_stock', { p_product_id: product_id, p_delta: sign * quantity })

    // After a stock-reducing movement, check if the product has crossed its threshold
    if (REDUCING_TYPES.has(type)) {
      await maybeNotifyLowStock(product_id)
    }
  } else {
    await db.pendingStockMovements.add(movement)
  }
}

async function maybeNotifyLowStock(product_id) {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('id, name, stock_quantity, reorder_threshold')
      .eq('id', product_id)
      .single()

    if (error || !product) return
    if (product.reorder_threshold == null) return
    if (product.stock_quantity > product.reorder_threshold) return

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return

    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-low-stock`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          product_id: product.id,
          product_name: product.name,
          stock_on_hand: product.stock_quantity,
          reorder_threshold: product.reorder_threshold,
        }),
      }
    )
    // Fire and forget — do not throw if the edge function fails.
    // The email is a best-effort alert; stock has already been decremented.
  } catch {
    // Silently swallow — never block the till on a notification failure
  }
}
```

Run tests — all 5 new tests pass. Count: **166 passing**.

### Step 3: Run the full test suite

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Verify: **166 tests passing, 0 failing**.

### Step 4: Commit

```bash
git add src/lib/products.js src/lib/__tests__/products.lowstock.test.js
git commit -m "feat: trigger notify-low-stock edge function after stock-reducing movements"
```

---

## Task 5 — `reorder_threshold` field on product edit form

**Files:**
- Modify: `src/components/stock/ProductFormModal.jsx`
- Modify: `src/components/stock/__tests__/ProductFormModal.test.jsx` (create if it does not exist)

### Step 1: Write the tests first

Create `src/components/stock/__tests__/ProductFormModal.threshold.test.jsx`:

```jsx
// src/components/stock/__tests__/ProductFormModal.threshold.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProductFormModal from '../ProductFormModal'

vi.mock('../../../lib/products', () => ({
  upsertProduct: vi.fn().mockResolvedValue({}),
  fetchProducts: vi.fn(),
  logStockMovement: vi.fn(),
}))

import { upsertProduct } from '../../../lib/products'

const noop = () => {}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProductFormModal — reorder_threshold field', () => {
  it('renders the Reorder Threshold field', () => {
    render(<ProductFormModal product={null} onClose={noop} onSaved={noop} />)
    expect(screen.getByLabelText(/reorder threshold/i)).toBeInTheDocument()
  })

  it('field is optional — label says "(optional)"', () => {
    render(<ProductFormModal product={null} onClose={noop} onSaved={noop} />)
    const label = screen.getByText(/reorder threshold/i)
    expect(label.textContent).toMatch(/optional/i)
  })

  it('field is empty by default for a new product', () => {
    render(<ProductFormModal product={null} onClose={noop} onSaved={noop} />)
    expect(screen.getByLabelText(/reorder threshold/i)).toHaveValue(null)
  })

  it('pre-fills the field when editing a product that has a threshold', () => {
    const product = {
      id: 'p1',
      name: 'Guinness',
      category: 'draught',
      standard_price: 5.5,
      member_price: 4.5,
      stock_quantity: 10,
      par_level: 8,
      unit: 'pint',
      supplier_id: '',
      cost_price: '',
      reorder_threshold: 12,
    }
    render(<ProductFormModal product={product} onClose={noop} onSaved={noop} />)
    expect(screen.getByLabelText(/reorder threshold/i)).toHaveValue(12)
  })

  it('pre-fills with empty when editing a product with no threshold', () => {
    const product = {
      id: 'p2',
      name: 'Coke',
      category: 'soft',
      standard_price: 2.5,
      member_price: 2.0,
      stock_quantity: 20,
      par_level: 5,
      unit: 'bottle',
      supplier_id: '',
      cost_price: '',
      reorder_threshold: null,
    }
    render(<ProductFormModal product={product} onClose={noop} onSaved={noop} />)
    expect(screen.getByLabelText(/reorder threshold/i)).toHaveValue(null)
  })

  it('includes reorder_threshold in the upsert payload when set', async () => {
    render(<ProductFormModal product={null} onClose={noop} onSaved={noop} />)

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Mild' } })
    fireEvent.change(screen.getByLabelText(/standard price/i), { target: { value: '4.00' } })
    fireEvent.change(screen.getByLabelText(/member price/i), { target: { value: '3.50' } })
    fireEvent.change(screen.getByLabelText(/stock quantity/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/par level/i), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText(/reorder threshold/i), { target: { value: '8' } })

    fireEvent.click(screen.getByRole('button', { name: /add product/i }))

    await waitFor(() => {
      expect(upsertProduct).toHaveBeenCalledWith(
        expect.objectContaining({ reorder_threshold: 8 })
      )
    })
  })

  it('omits reorder_threshold from payload when field is left empty', async () => {
    render(<ProductFormModal product={null} onClose={noop} onSaved={noop} />)

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Mild' } })
    fireEvent.change(screen.getByLabelText(/standard price/i), { target: { value: '4.00' } })
    fireEvent.change(screen.getByLabelText(/member price/i), { target: { value: '3.50' } })
    fireEvent.change(screen.getByLabelText(/stock quantity/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/par level/i), { target: { value: '10' } })
    // Leave reorder_threshold empty

    fireEvent.click(screen.getByRole('button', { name: /add product/i }))

    await waitFor(() => {
      const payload = upsertProduct.mock.calls[0][0]
      expect(payload).not.toHaveProperty('reorder_threshold')
    })
  })
})
```

Run — expect **7 new failures**. Total: 166 passing, 7 failing.

### Step 2: Update `ProductFormModal.jsx`

Three changes:
1. Add `reorder_threshold` to `form` state initialisation
2. Include the optional `reorder_threshold` input in the JSX (alongside cost price)
3. Include `reorder_threshold` in the submit payload only when it has a value

In `ProductFormModal.jsx`, update the `form` state initialiser:

```javascript
const [form, setForm] = useState({
  name: product?.name ?? '',
  category: product?.category ?? 'draught',
  standard_price: product?.standard_price ?? '',
  member_price: product?.member_price ?? '',
  stock_quantity: product?.stock_quantity ?? '',
  par_level: product?.par_level ?? '',
  unit: product?.unit ?? 'pint',
  supplier_id: product?.supplier_id ?? '',
  cost_price: product?.cost_price ?? '',
  reorder_threshold: product?.reorder_threshold ?? '',
})
```

Update `handleSubmit` to include `reorder_threshold` when set:

```javascript
async function handleSubmit(e) {
  e.preventDefault()
  setSaving(true)
  setError(null)
  try {
    const payload = {
      ...(isEditing ? { id: product.id } : {}),
      name: form.name.trim(),
      category: form.category,
      standard_price: Number(form.standard_price),
      member_price: Number(form.member_price),
      stock_quantity: Number(form.stock_quantity),
      par_level: Number(form.par_level),
      unit: form.unit,
      active: true,
    }
    if (form.supplier_id.trim()) payload.supplier_id = form.supplier_id.trim()
    if (form.cost_price !== '') payload.cost_price = Number(form.cost_price)
    if (form.reorder_threshold !== '') payload.reorder_threshold = Number(form.reorder_threshold)

    await upsertProduct(payload)
    onSaved()
  } catch (err) {
    setError(err.message ?? 'An error occurred. Please try again.')
    setSaving(false)
  }
}
```

Add the `reorder_threshold` input field in the JSX after the cost price field and before the supplier ID field:

```jsx
{/* Reorder Threshold (optional) */}
<div className="flex flex-col gap-1">
  <label htmlFor="pf-reorder-threshold" className="text-sm font-medium text-slate-300">
    Reorder Threshold <span className="text-slate-500 font-normal">(optional)</span>
  </label>
  <input
    id="pf-reorder-threshold"
    type="number"
    min="0"
    step="1"
    value={form.reorder_threshold}
    onChange={handleChange('reorder_threshold')}
    placeholder="e.g. 12"
    className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
  />
  <p className="text-xs text-slate-500">
    Email alert sent to manager when stock drops to or below this number.
  </p>
</div>
```

Run tests — all 7 new tests pass. Count: **173 passing**.

### Step 3: Run the full test suite

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Verify: **173 tests passing, 0 failing**.

### Step 4: Commit

```bash
git add src/components/stock/ProductFormModal.jsx src/components/stock/__tests__/ProductFormModal.threshold.test.jsx
git commit -m "feat: reorder_threshold field on product add/edit form"
```

---

## Final verification

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected final state: **173 tests passing, 0 failing** (147 baseline + 26 new).

### Smoke test checklist (manual)

- [ ] Add a product with a reorder threshold of 10 via the product form
- [ ] Log wastage to bring stock to exactly 10 — stock page filter button should show "1"
- [ ] The Stock nav badge shows "1" in red
- [ ] Clicking "Low stock" filter shows only that product; Coke (no threshold) disappears
- [ ] That product's row has an amber background tint
- [ ] Clicking "Low stock" again restores all products
- [ ] Check Supabase logs for the `notify-low-stock` function invocation
- [ ] Log wastage again within an hour — edge function returns `{ sent: false }` (debounce)
- [ ] Restock the product above threshold — badge disappears after page reload
- [ ] Set `MANAGER_EMAIL` in Supabase dashboard → Project Settings → Edge Functions → Secrets; verify email arrives

### Deploy edge function

```bash
supabase functions deploy notify-low-stock
```

Set the required secret:

```bash
supabase secrets set MANAGER_EMAIL=manager@fairmile.club
```

---

## File summary

| File | Action |
|------|--------|
| `supabase/migrations/20260330_low_stock_alerts.sql` | Create |
| `supabase/functions/notify-low-stock/index.ts` | Create |
| `src/stores/lowStockStore.js` | Create |
| `src/stores/__tests__/lowStockStore.test.js` | Create |
| `src/components/NavBar.jsx` | Modify |
| `src/components/__tests__/NavBar.lowstock.test.jsx` | Create |
| `src/pages/StockPage.jsx` | Modify |
| `src/components/stock/__tests__/StockPage.lowstock.test.jsx` | Create |
| `src/components/stock/StockList.jsx` | Modify |
| `src/components/stock/__tests__/StockList.test.jsx` | Modify (append) |
| `src/lib/products.js` | Modify |
| `src/lib/__tests__/products.lowstock.test.js` | Create |
| `src/components/stock/ProductFormModal.jsx` | Modify |
| `src/components/stock/__tests__/ProductFormModal.threshold.test.jsx` | Create |
