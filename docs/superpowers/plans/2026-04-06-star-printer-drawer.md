# Star mC-Print3 Printer & Cash Drawer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Integrate receipt printing and cash drawer control into Dionysus POS using Star WebPRNT over Ethernet, with simulation mode when no printer IP is configured.

**Architecture:** A pure `starPrinter.js` library handles all WebPRNT HTTP calls. `TillPage.handleCheckout` calls `printReceipt` after every sale (with drawer pulse embedded for cash). `CashbackModal` calls `openDrawer` after recording cashback. A lightweight Zustand toast system surfaces print failures without blocking transactions.

**Tech Stack:** React 19, Zustand 5, Vitest 4, Testing Library, native `fetch()`, Star WebPRNT XML over HTTP, Tailwind CSS 4, lucide-react

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/lib/starPrinter.js` | Create | WebPRNT client — `getPrinterIp`, `printReceipt`, `openDrawer` |
| `src/lib/starPrinter.test.js` | Create | Unit tests for all printer functions |
| `src/hooks/useToast.js` | Create | Zustand toast store — `addToast`, `removeToast` |
| `src/hooks/useToast.test.js` | Create | Unit tests for toast store |
| `src/components/ui/Toast.jsx` | Create | Toast display component |
| `src/components/Layout.jsx` | Modify | Render `<Toast />` |
| `src/pages/TillPage.jsx` | Modify | Call `printReceipt` after checkout; toast on failure |
| `src/components/till/CashbackModal.jsx` | Modify | Call `openDrawer` after cashback; toast on failure |
| `src/pages/SettingsPage.jsx` | Create | Printer IP config, test connection, manual open drawer |
| `src/pages/SettingsPage.test.jsx` | Create | Unit tests for Settings page |
| `src/App.jsx` | Modify | Add `/settings` route |
| `src/components/NavBar.jsx` | Modify | Add Settings nav link |

---

## Task 1: `src/lib/starPrinter.js`

**Files:**
- Create: `src/lib/starPrinter.test.js`
- Create: `src/lib/starPrinter.js`

---

- [x] **Step 1.1: Write the failing tests**

Create `src/lib/starPrinter.test.js`:

```javascript
import { getPrinterIp, printReceipt, openDrawer } from './starPrinter'

const RECEIPT = {
  orderId: 'some-uuid-ABCD1234',
  total: 12.50,
  paymentMethod: 'cash',
  createdAt: '2026-04-06T14:32:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── getPrinterIp ───────────────────────────────────────────────────────────

describe('getPrinterIp', () => {
  it('returns null when no IP is stored', () => {
    expect(getPrinterIp()).toBeNull()
  })

  it('returns the stored IP', () => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    expect(getPrinterIp()).toBe('192.168.1.100')
  })
})

// ─── printReceipt — simulation mode ─────────────────────────────────────────

describe('printReceipt — simulation mode (no IP)', () => {
  it('resolves without throwing', async () => {
    await expect(printReceipt(RECEIPT)).resolves.toBeUndefined()
  })

  it('logs XML to console.info', async () => {
    await printReceipt(RECEIPT)
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.stringContaining('THE FAIRMILE SPORTS')
    )
  })
})

// ─── printReceipt — with IP ──────────────────────────────────────────────────

describe('printReceipt — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the correct Star WebPRNT URL', async () => {
    await printReceipt(RECEIPT)
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.100/StarWebPRNT/SendMessage',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends Content-Type: application/xml', async () => {
    await printReceipt(RECEIPT)
    const headers = fetch.mock.calls[0][1].headers
    expect(headers['Content-Type']).toBe('application/xml')
  })

  it('XML body contains club name', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('THE FAIRMILE SPORTS')
  })

  it('XML body contains formatted total', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('12.50')
  })

  it('XML body contains last 8 chars of orderId uppercased', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('ABCD1234')
  })

  it('XML body contains capitalised payment method', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('Cash')
  })

  it('XML body contains drawer pulse for cash payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'cash' })
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('openDrawer')
  })

  it('XML body does NOT contain drawer pulse for card payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'card' })
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('openDrawer')
  })

  it('XML body does NOT contain drawer pulse for tab payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'tab' })
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('openDrawer')
  })

  it('throws when printer returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(printReceipt(RECEIPT)).rejects.toThrow('Printer returned 503')
  })
})

// ─── openDrawer ──────────────────────────────────────────────────────────────

describe('openDrawer — simulation mode (no IP)', () => {
  it('resolves without throwing', async () => {
    await expect(openDrawer()).resolves.toBeUndefined()
  })

  it('logs to console.info', async () => {
    await openDrawer()
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.any(String)
    )
  })
})

describe('openDrawer — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the correct URL', async () => {
    await openDrawer()
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.100/StarWebPRNT/SendMessage',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('XML body contains drawer pulse', async () => {
    await openDrawer()
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('openDrawer')
  })

  it('XML body does NOT contain receipt content', async () => {
    await openDrawer()
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('FAIRMILE')
  })

  it('throws when printer returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(openDrawer()).rejects.toThrow('Printer returned 503')
  })
})
```

- [x] **Step 1.2: Run tests — verify they all fail**

```bash
cd /Users/eoghainmclaughlin/Dionysus
npx vitest run src/lib/starPrinter.test.js
```

Expected: all tests FAIL with "Cannot find module './starPrinter'"

---

- [x] **Step 1.3: Create `src/lib/starPrinter.js`**

```javascript
const PRINTER_IP_KEY = 'printer_ip'
const WEBPRNT_PATH = '/StarWebPRNT/SendMessage'

export function getPrinterIp() {
  return localStorage.getItem(PRINTER_IP_KEY)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(isoString) {
  const d = new Date(isoString)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildReceiptXml({ orderId, total, paymentMethod, createdAt, includeDrawer }) {
  const dateTime = formatDate(createdAt)
  const receiptRef = String(orderId).slice(-8).toUpperCase()
  const methodLabel = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)
  const totalStr = `\u00a3${Number(total).toFixed(2)}`
  const drawerXml = includeDrawer
    ? '\n    <peripheral channel="1" type="openDrawer"/>'
    : ''

  return `<?xml version="1.0" encoding="utf-8"?>
<root>
  <document>
    <align mode="center"/>
    <bold/>
    <text>THE FAIRMILE SPORTS &amp; SOCIAL CLUB\n</text>
    <bold_cancel/>
    <text>\n</text>
    <align mode="left"/>
    <text>${dateTime}\n</text>
    <text>Receipt #${receiptRef}\n</text>
    <text>${methodLabel}\n</text>
    <text>\n</text>
    <bold/>
    <text>TOTAL: ${totalStr}\n</text>
    <bold_cancel/>
    <text>\n</text>
    <align mode="center"/>
    <text>Thank you for your visit\n</text>
    <feed line="3"/>
    <cut type="partial"/>${drawerXml}
  </document>
</root>`
}

function buildDrawerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<root>
  <document>
    <peripheral channel="1" type="openDrawer"/>
  </document>
</root>`
}

async function sendXml(ip, xml) {
  const res = await fetch(`http://${ip}${WEBPRNT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  })
  if (!res.ok) {
    throw new Error(`Printer returned ${res.status}`)
  }
}

export async function printReceipt({ orderId, total, paymentMethod, createdAt }) {
  const ip = getPrinterIp()
  const xml = buildReceiptXml({
    orderId,
    total,
    paymentMethod,
    createdAt,
    includeDrawer: paymentMethod === 'cash',
  })
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:\n', xml)
    return
  }
  await sendXml(ip, xml)
}

export async function openDrawer() {
  const ip = getPrinterIp()
  const xml = buildDrawerXml()
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:\n', xml)
    return
  }
  await sendXml(ip, xml)
}
```

- [x] **Step 1.4: Run tests — verify they all pass**

```bash
npx vitest run src/lib/starPrinter.test.js
```

Expected: all tests PASS

---

- [x] **Step 1.5: Commit**

```bash
git add src/lib/starPrinter.js src/lib/starPrinter.test.js
git commit -m "feat: add Star WebPRNT printer and drawer library"
```

---

## Task 2: Toast Store (`src/hooks/useToast.js`)

**Files:**
- Create: `src/hooks/useToast.test.js`
- Create: `src/hooks/useToast.js`

---

- [x] **Step 2.1: Write the failing tests**

Create `src/hooks/useToast.test.js`:

```javascript
import { act } from 'react'
import { useToastStore } from './useToast'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToastStore', () => {
  it('starts with an empty toasts array', () => {
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('addToast adds a toast with message and type', () => {
    useToastStore.getState().addToast('Print failed', 'error')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ message: 'Print failed', type: 'error' })
  })

  it('addToast assigns a unique numeric id', () => {
    useToastStore.getState().addToast('First', 'error')
    useToastStore.getState().addToast('Second', 'success')
    const toasts = useToastStore.getState().toasts
    expect(toasts[0].id).toBeDefined()
    expect(toasts[0].id).not.toBe(toasts[1].id)
  })

  it('toast is auto-removed after 4 seconds', () => {
    useToastStore.getState().addToast('Test', 'error')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(4000))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('toast is NOT removed before 4 seconds', () => {
    useToastStore.getState().addToast('Test', 'error')
    act(() => vi.advanceTimersByTime(3999))
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('removeToast removes a toast by id', () => {
    useToastStore.getState().addToast('Test', 'error')
    const { id } = useToastStore.getState().toasts[0]
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('removeToast does not remove other toasts', () => {
    useToastStore.getState().addToast('First', 'error')
    useToastStore.getState().addToast('Second', 'error')
    const firstId = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(firstId)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Second')
  })
})
```

- [x] **Step 2.2: Run tests — verify they fail**

```bash
npx vitest run src/hooks/useToast.test.js
```

Expected: FAIL with "Cannot find module './useToast'"

---

- [x] **Step 2.3: Create `src/hooks/useToast.js`**

```javascript
import { create } from 'zustand'

export const useToastStore = create((set) => ({
  toasts: [],

  addToast: (message, type = 'error') => {
    const id = Date.now() + Math.random()
    set(state => ({ toasts: [...state.toasts, { id, message, type }] }))
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
    }, 4000)
  },

  removeToast: (id) =>
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}))
```

- [x] **Step 2.4: Run tests — verify they all pass**

```bash
npx vitest run src/hooks/useToast.test.js
```

Expected: all tests PASS

---

- [x] **Step 2.5: Commit**

```bash
git add src/hooks/useToast.js src/hooks/useToast.test.js
git commit -m "feat: add toast notification store"
```

---

## Task 3: Toast Component + Wire into Layout

**Files:**
- Create: `src/components/ui/Toast.jsx`
- Modify: `src/components/Layout.jsx`

---

- [x] **Step 3.1: Create `src/components/ui/Toast.jsx`**

```jsx
import { useToastStore } from '../../hooks/useToast'

const COLOURS = {
  error: 'bg-red-900 border-red-700',
  success: 'bg-emerald-900 border-emerald-700',
}

export default function Toast() {
  const { toasts, removeToast } = useToastStore()
  const toast = toasts[0]

  if (!toast) return null

  const colourClass = COLOURS[toast.type] ?? COLOURS.error

  return (
    <div className="fixed bottom-20 right-4 z-50 md:bottom-4">
      <button
        onClick={() => removeToast(toast.id)}
        className={`${colourClass} border text-white text-sm font-medium
          px-4 py-3 rounded-xl shadow-lg max-w-xs text-left cursor-pointer`}
        aria-live="polite"
      >
        {toast.message}
      </button>
    </div>
  )
}
```

- [x] **Step 3.2: Add `<Toast />` to Layout**

Open `src/components/Layout.jsx`. The current file is:

```jsx
import { useEffect } from 'react'
import NavBar from './NavBar'
import StatusBar from './StatusBar'
import { initConnectivityListener } from '../lib/sync'
import { useSyncStore } from '../stores/syncStore'

export default function Layout({ children }) {
  const setOnline = useSyncStore(s => s.setOnline)

  useEffect(() => {
    setOnline(navigator.onLine)
    initConnectivityListener()
  }, [setOnline])

  return (
    <div className="flex h-screen overflow-hidden bg-[#020617] flex-col">
      <StatusBar />
      <div className="flex flex-1 overflow-hidden">
        <NavBar />
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}
```

Replace with:

```jsx
import { useEffect } from 'react'
import NavBar from './NavBar'
import StatusBar from './StatusBar'
import Toast from './ui/Toast'
import { initConnectivityListener } from '../lib/sync'
import { useSyncStore } from '../stores/syncStore'

export default function Layout({ children }) {
  const setOnline = useSyncStore(s => s.setOnline)

  useEffect(() => {
    setOnline(navigator.onLine)
    initConnectivityListener()
  }, [setOnline])

  return (
    <div className="flex h-screen overflow-hidden bg-[#020617] flex-col">
      <StatusBar />
      <div className="flex flex-1 overflow-hidden">
        <NavBar />
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
      <Toast />
    </div>
  )
}
```

- [x] **Step 3.3: Verify the app still builds**

```bash
npx vitest run
```

Expected: existing tests still PASS, no new failures

---

- [x] **Step 3.4: Commit**

```bash
git add src/components/ui/Toast.jsx src/components/Layout.jsx
git commit -m "feat: add toast notification component"
```

---

## Task 4: Wire Printer into TillPage

**Files:**
- Modify: `src/pages/TillPage.jsx`

---

- [x] **Step 4.1: Add print call to `handleCheckout`**

Open `src/pages/TillPage.jsx`. Make these two changes:

**Add imports** at the top (after existing imports):

```javascript
import { printReceipt } from '../lib/starPrinter'
import { useToastStore } from '../hooks/useToast'
```

**Replace `handleCheckout`** — the current implementation is:

```javascript
const handleCheckout = useCallback(async (paymentMethod) => {
  const total = useTillStore.getState().getTotal()
  const currentItems = useTillStore.getState().orderItems
  const currentMember = useTillStore.getState().activeMember

  const order = {
    member_id: currentMember?.id ?? null,
    payment_method: paymentMethod,
    total_amount: total,
    status: 'paid',
    till_id: 'till-1',
    created_at: new Date().toISOString(),
  }
  const items = currentItems.map(i => ({
    product_id: i.product_id,
    quantity: i.quantity,
    unit_price: i.unit_price,
    member_price_applied: i.member_price_applied,
  }))

  if (isOnline) {
    const { data, error } = await supabase.from('orders').insert(order).select().single()
    if (!error) {
      await Promise.all([
        supabase.from('order_items').insert(items.map(i => ({ ...i, order_id: data.id }))),
        paymentMethod === 'tab' && currentMember
          ? addToTabBalance(currentMember.id, total)
          : Promise.resolve(),
      ])
    }
  } else {
    await db.pendingOrders.add({ order, items })
  }

  clearOrder()
}, [isOnline, clearOrder])
```

Replace with:

```javascript
const handleCheckout = useCallback(async (paymentMethod) => {
  const total = useTillStore.getState().getTotal()
  const currentItems = useTillStore.getState().orderItems
  const currentMember = useTillStore.getState().activeMember

  const order = {
    member_id: currentMember?.id ?? null,
    payment_method: paymentMethod,
    total_amount: total,
    status: 'paid',
    till_id: 'till-1',
    created_at: new Date().toISOString(),
  }
  const items = currentItems.map(i => ({
    product_id: i.product_id,
    quantity: i.quantity,
    unit_price: i.unit_price,
    member_price_applied: i.member_price_applied,
  }))

  let orderId = `OFF-${Date.now()}`

  if (isOnline) {
    const { data, error } = await supabase.from('orders').insert(order).select().single()
    if (!error) {
      orderId = data.id
      await Promise.all([
        supabase.from('order_items').insert(items.map(i => ({ ...i, order_id: data.id }))),
        paymentMethod === 'tab' && currentMember
          ? addToTabBalance(currentMember.id, total)
          : Promise.resolve(),
      ])
    }
  } else {
    await db.pendingOrders.add({ order, items })
  }

  try {
    await printReceipt({ orderId, total, paymentMethod, createdAt: order.created_at })
  } catch {
    useToastStore.getState().addToast('Print failed — check printer connection', 'error')
  }

  clearOrder()
}, [isOnline, clearOrder])
```

- [x] **Step 4.2: Run existing tests — verify nothing is broken**

```bash
npx vitest run
```

Expected: all existing tests PASS. The existing TillPage tests mock Supabase and tillStore — `printReceipt` will run in simulation mode (no IP in localStorage) so it won't throw or make network calls.

---

- [x] **Step 4.3: Commit**

```bash
git add src/pages/TillPage.jsx
git commit -m "feat: print receipt after every checkout"
```

---

## Task 5: Wire Drawer into CashbackModal

**Files:**
- Modify: `src/components/till/CashbackModal.jsx`

---

- [x] **Step 5.1: Add drawer call to `CashbackModal`**

Open `src/components/till/CashbackModal.jsx`. The current file imports and `handleSubmit` are:

```javascript
import { useState } from 'react'
import { X } from '../../lib/icons'
import { recordCashback } from '../../lib/cashback'
import { useSessionStore } from '../../stores/sessionStore'
```

```javascript
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
```

**Add two imports** after the existing imports:

```javascript
import { openDrawer } from '../../lib/starPrinter'
import { useToastStore } from '../../hooks/useToast'
```

**Add `addToast`** at the top of the component function, after `activeStaff`:

```javascript
const addToast = useToastStore(s => s.addToast)
```

**Replace `handleSubmit`** with:

```javascript
async function handleSubmit(e) {
  e.preventDefault()
  const val = parseFloat(amount)
  if (!val || val <= 0) { setError('Enter a valid amount'); return }
  setSaving(true)
  setError(null)
  try {
    await recordCashback(val, activeStaff?.id)
    try {
      await openDrawer()
    } catch {
      addToast('Drawer failed — use manual open in Settings', 'error')
    }
    onSaved()
  } catch (err) {
    setError(err.message ?? 'Failed to record cashback')
  } finally {
    setSaving(false)
  }
}
```

- [x] **Step 5.2: Run existing tests**

```bash
npx vitest run
```

Expected: all tests PASS

---

- [x] **Step 5.3: Commit**

```bash
git add src/components/till/CashbackModal.jsx
git commit -m "feat: open cash drawer after cashback transaction"
```

---

## Task 6: SettingsPage + Tests

**Files:**
- Create: `src/pages/SettingsPage.test.jsx`
- Create: `src/pages/SettingsPage.jsx`

---

- [x] **Step 6.1: Write the failing tests**

Create `src/pages/SettingsPage.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsPage from './SettingsPage'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'

vi.mock('../lib/starPrinter', () => ({
  getPrinterIp: vi.fn(() => null),
  printReceipt: vi.fn().mockResolvedValue(undefined),
  openDrawer: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  getPrinterIp.mockReturnValue(null)
})

describe('SettingsPage — IP input', () => {
  it('shows empty input when no IP is stored', () => {
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/192\.168/i)).toHaveValue('')
  })

  it('pre-populates input from getPrinterIp()', () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/192\.168/i)).toHaveValue('192.168.1.100')
  })

  it('Save button writes trimmed IP to localStorage', async () => {
    render(<SettingsPage />)
    await userEvent.type(screen.getByPlaceholderText(/192\.168/i), '10.0.0.1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(localStorage.getItem('printer_ip')).toBe('10.0.0.1')
  })

  it('shows Saved confirmation after clicking Save', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/Saved/)).toBeInTheDocument()
  })
})

describe('SettingsPage — Test Connection', () => {
  it('shows simulation mode message when IP input is empty', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(screen.getByText('Simulation mode — no IP configured')).toBeInTheDocument()
    expect(printReceipt).not.toHaveBeenCalled()
  })

  it('calls printReceipt when IP is in the input field', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(printReceipt).toHaveBeenCalled()
  })

  it('shows success message when printReceipt resolves', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByText('Test print sent')).toBeInTheDocument()
  })

  it('shows error message when printReceipt throws', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    printReceipt.mockRejectedValue(new Error('refused'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByText(/Connection failed/)).toBeInTheDocument()
  })
})

describe('SettingsPage — Open Drawer', () => {
  it('calls openDrawer when button is clicked', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(openDrawer).toHaveBeenCalled()
  })

  it('shows success message when openDrawer resolves', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(await screen.findByText('Drawer opened')).toBeInTheDocument()
  })

  it('shows error message when openDrawer throws', async () => {
    openDrawer.mockRejectedValue(new Error('refused'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(await screen.findByText('Failed to open drawer')).toBeInTheDocument()
  })
})
```

- [x] **Step 6.2: Run tests — verify they fail**

```bash
npx vitest run src/pages/SettingsPage.test.jsx
```

Expected: FAIL with "Cannot find module './SettingsPage'"

---

- [x] **Step 6.3: Create `src/pages/SettingsPage.jsx`**

```jsx
import { useState } from 'react'
import { Printer } from 'lucide-react'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'

export default function SettingsPage() {
  const [ip, setIp] = useState(() => getPrinterIp() ?? '')
  const [saveStatus, setSaveStatus] = useState(null)
  const [testStatus, setTestStatus] = useState(null)
  const [drawerStatus, setDrawerStatus] = useState(null)

  function handleSave() {
    localStorage.setItem('printer_ip', ip.trim())
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(null), 3000)
  }

  async function handleTest() {
    setTestStatus(null)
    if (!ip.trim()) {
      setTestStatus('simulation')
      return
    }
    try {
      await printReceipt({
        orderId: 'TEST0000',
        total: 0.00,
        paymentMethod: 'card',
        createdAt: new Date().toISOString(),
      })
      setTestStatus('success')
    } catch {
      setTestStatus('error')
    }
  }

  async function handleOpenDrawer() {
    setDrawerStatus(null)
    try {
      await openDrawer()
      setDrawerStatus('success')
    } catch {
      setDrawerStatus('error')
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-white text-xl font-bold mb-6">Settings</h1>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Printer size={18} className="text-slate-400" aria-hidden="true" />
          <h2 className="text-white font-semibold">Receipt Printer</h2>
        </div>

        <div className="space-y-2">
          <label htmlFor="printer-ip" className="text-slate-400 text-sm block">
            Printer IP Address
          </label>
          <div className="flex gap-2">
            <input
              id="printer-ip"
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="e.g. 192.168.1.100"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2
                text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold
                px-4 py-2 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Save
            </button>
          </div>
          {saveStatus === 'saved' && (
            <p className="text-emerald-400 text-xs">Saved ✓</p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <div className="flex-1 space-y-1">
            <button
              onClick={handleTest}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium
                py-3 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Test Connection
            </button>
            {testStatus === 'success' && (
              <p className="text-emerald-400 text-xs">Test print sent</p>
            )}
            {testStatus === 'error' && (
              <p className="text-red-400 text-xs">Connection failed — check IP and printer power</p>
            )}
            {testStatus === 'simulation' && (
              <p className="text-slate-400 text-xs">Simulation mode — no IP configured</p>
            )}
          </div>

          <div className="flex-1 space-y-1">
            <button
              onClick={handleOpenDrawer}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium
                py-3 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Open Drawer
            </button>
            {drawerStatus === 'success' && (
              <p className="text-emerald-400 text-xs">Drawer opened</p>
            )}
            {drawerStatus === 'error' && (
              <p className="text-red-400 text-xs">Failed to open drawer</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
```

- [x] **Step 6.4: Run tests — verify they all pass**

```bash
npx vitest run src/pages/SettingsPage.test.jsx
```

Expected: all tests PASS

---

- [x] **Step 6.5: Commit**

```bash
git add src/pages/SettingsPage.jsx src/pages/SettingsPage.test.jsx
git commit -m "feat: add printer settings page"
```

---

## Task 7: Route + NavBar Link

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/NavBar.jsx`

---

- [x] **Step 7.1: Add `/settings` route to `src/App.jsx`**

Current `src/App.jsx`:

```javascript
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TillPage from './pages/TillPage'
import StockPage from './pages/StockPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'
import TabsPage from './pages/TabsPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TillPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/tabs" element={<TabsPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </Layout>
  )
}
```

Replace with:

```javascript
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TillPage from './pages/TillPage'
import StockPage from './pages/StockPage'
import MembersPage from './pages/MembersPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'
import TabsPage from './pages/TabsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TillPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/tabs" element={<TabsPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}
```

- [x] **Step 7.2: Add Settings link to `src/components/NavBar.jsx`**

Current imports line in `NavBar.jsx`:

```javascript
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, ArrowLeftRight } from 'lucide-react'
```

Replace with:

```javascript
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, ArrowLeftRight, Settings } from 'lucide-react'
```

Current `links` array:

```javascript
const links = [
  { to: '/', label: 'Till', Icon: ShoppingCart },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/tabs', label: 'Tabs', Icon: Receipt },
  { to: '/promos', label: 'Promos', Icon: Tag },
  { to: '/reports', label: 'Reports', Icon: BarChart2 },
]
```

Replace with:

```javascript
const links = [
  { to: '/', label: 'Till', Icon: ShoppingCart },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/tabs', label: 'Tabs', Icon: Receipt },
  { to: '/promos', label: 'Promos', Icon: Tag },
  { to: '/reports', label: 'Reports', Icon: BarChart2 },
  { to: '/settings', label: 'Settings', Icon: Settings },
]
```

- [x] **Step 7.3: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS

---

- [x] **Step 7.4: Commit**

```bash
git add src/App.jsx src/components/NavBar.jsx
git commit -m "feat: add settings route and nav link"
```

---

## Final Verification

- [x] **Step 8.1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests PASS with no failures

- [x] **Step 8.2: Verify the production build**

```bash
npm run build
```

Expected: build completes with no errors

---

## Manual Smoke Test Checklist (once printer is purchased and on the network)

1. Go to Settings → enter printer IP → click Save
2. Click Test Connection → receipt prints, "Test print sent" shown
3. Click Open Drawer → drawer opens, "Drawer opened" shown
4. Make a **cash** sale → receipt prints + drawer opens
5. Make a **card** sale → receipt prints, drawer stays closed
6. Make a **tab** sale → receipt prints, drawer stays closed
7. Record **cashback** → drawer opens, no receipt
8. Disconnect printer → make a sale → toast "Print failed" appears, sale still completes
9. Reconnect printer → sales print again normally
