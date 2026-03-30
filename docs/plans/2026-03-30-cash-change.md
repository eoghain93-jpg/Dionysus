# Cash Change Calculator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a cashier clicks "Cash", a modal opens with a touch numpad and quick-select note buttons so they can enter the tendered amount, see the change due in real time, then confirm to transition to a large "Give change" screen before the order clears.

**Architecture:** A new standalone `CashPaymentModal` component manages all cash payment UI (entry step + change-due step) via internal state. `OrderPanel` renders it conditionally with local state — no changes to `tillStore` or the existing `handleCheckout` flow.

**Tech Stack:** React, Vitest, @testing-library/react, Tailwind CSS, lucide-react

---

### Task 1: `CashPaymentModal` — tests and implementation

**Files:**
- Create: `src/components/till/CashPaymentModal.jsx`
- Create: `src/components/till/CashPaymentModal.test.jsx`

**Step 1: Write the failing tests**

```jsx
// src/components/till/CashPaymentModal.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CashPaymentModal from './CashPaymentModal'

describe('CashPaymentModal', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    onConfirm.mockClear()
    onCancel.mockClear()
  })

  it('displays the order total', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByText('£7.50')).toBeInTheDocument()
  })

  it('confirm button is disabled when nothing entered', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('quick-select £10 sets tendered amount and enables confirm', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(screen.getByText('£10.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
  })

  it('quick-select below total keeps confirm disabled', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£5' }))
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('shows correct change when tendered exceeds total', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(screen.getByText('£2.50')).toBeInTheDocument()
  })

  it('numpad builds amount digit by digit', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByText('£10.00')).toBeInTheDocument()
  })

  it('backspace removes last digit', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('£1.00')).toBeInTheDocument()
  })

  it('confirming transitions to change-due step', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.getByText(/give change/i)).toBeInTheDocument()
    expect(screen.getByText('£2.50')).toBeInTheDocument()
  })

  it('Done button on change step calls onConfirm', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Cancel button calls onCancel', () => {
    render(<CashPaymentModal total={7.50} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test -- --run
```

Expected: 9 new failures about `CashPaymentModal` not found.

**Step 3: Implement `CashPaymentModal`**

The numpad stores input as a string of digits (no decimal point entered by the user — amounts are always whole pounds for simplicity). Displaying as `£X.00`. Quick-select buttons set the string directly (e.g. `'1000'` for £10). Backspace removes the last character.

Change is `tendered - total`, shown as `£X.XX`.

```jsx
// src/components/till/CashPaymentModal.jsx
import { useState } from 'react'
import { Delete } from 'lucide-react'

const QUICK_AMOUNTS = [5, 10, 20, 50]
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`
}

export default function CashPaymentModal({ total, onConfirm, onCancel }) {
  const [digits, setDigits] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const totalPence = Math.round(total * 100)
  const tenderedPence = digits ? parseInt(digits, 10) : 0
  const changePence = tenderedPence - totalPence
  const canConfirm = tenderedPence >= totalPence

  function handleKey(key) {
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === '.') {
      // ignore — whole pounds only
    } else {
      // max 6 digits (£9999.99 equivalent)
      setDigits(d => d.length < 6 ? d + key : d)
    }
  }

  function handleQuick(pounds) {
    setDigits(String(pounds * 100))
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
        <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-sm text-center space-y-6">
          <h2 className="text-white text-xl font-bold">Give change</h2>
          <div className="text-green-400 text-6xl font-bold">{formatPence(changePence)}</div>
          <button
            onClick={onConfirm}
            className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl text-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-lg font-bold">Cash Payment</h2>
          <span className="text-slate-400 text-sm">Total: <span className="text-white font-semibold">£{total.toFixed(2)}</span></span>
        </div>

        {/* Quick-select notes */}
        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map(amt => (
            <button
              key={amt}
              onClick={() => handleQuick(amt)}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors cursor-pointer"
            >
              £{amt}
            </button>
          ))}
        </div>

        {/* Tendered display */}
        <div className="bg-slate-900 rounded-xl px-4 py-3 text-center">
          <div className="text-white text-3xl font-bold tracking-wide">
            {formatPence(tenderedPence)}
          </div>
          {changePence > 0 && (
            <div className="text-slate-400 text-sm mt-1">
              Change: <span className="text-green-400 font-semibold">{formatPence(changePence)}</span>
            </div>
          )}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {NUMPAD_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              aria-label={key === 'back' ? 'Backspace' : key}
              className="bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-semibold
                py-4 rounded-xl text-xl transition-all cursor-pointer flex items-center justify-center"
            >
              {key === 'back' ? <Delete size={20} aria-hidden="true" /> : key}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => setConfirmed(true)}
            disabled={!canConfirm}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed
              text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Run tests to confirm they pass**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test -- --run
```

Expected: all 132 + 9 new tests pass.

**Step 5: Commit**

```bash
git add src/components/till/CashPaymentModal.jsx src/components/till/CashPaymentModal.test.jsx
git commit -m "feat: add CashPaymentModal with numpad and change display"
```

---

### Task 2: Wire `CashPaymentModal` into `OrderPanel`

**Files:**
- Modify: `src/components/till/OrderPanel.jsx`

**Step 1: Update `OrderPanel`**

Add `showCashModal` local state. Change the Cash button to set it instead of calling `handleCheckout`. Render the modal conditionally.

In [OrderPanel.jsx](src/components/till/OrderPanel.jsx), make these three changes:

**Add import** (after the existing imports):
```jsx
import CashPaymentModal from './CashPaymentModal'
```

**Add state** (inside the component, after the `paying` state line):
```jsx
const [showCashModal, setShowCashModal] = useState(false)
```

**Change the Cash button's onClick** from:
```jsx
onClick={() => handleCheckout(method)
```
to (only for the cash method — use a conditional inside the map):
```jsx
onClick={() => method === 'cash' ? setShowCashModal(true) : handleCheckout(method)}
```

**Add modal render** (just before the closing `</div>` of the component return):
```jsx
{showCashModal && (
  <CashPaymentModal
    total={total}
    onConfirm={() => { setShowCashModal(false); handleCheckout('cash') }}
    onCancel={() => setShowCashModal(false)}
  />
)}
```

**Step 2: Run all tests**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH"
npm test -- --run
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/components/till/OrderPanel.jsx
git commit -m "feat: wire CashPaymentModal into OrderPanel"
```
