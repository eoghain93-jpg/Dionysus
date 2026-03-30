# Cash Change Calculator — Design

## Goal

When a customer pays cash, the cashier clicks "Cash" on the till. A modal opens where they enter or quick-select the tendered amount. The modal shows the change due in real time, then transitions to a large "Give change" confirmation screen. Tapping Done processes the order and clears the till.

## Architecture

A new standalone component `CashPaymentModal` handles all cash payment UI. `OrderPanel` renders it conditionally via local state. No changes to `tillStore` or the existing `handleCheckout('cash')` flow.

**Files changed:**
- Create: `src/components/till/CashPaymentModal.jsx`
- Create: `src/components/till/CashPaymentModal.test.jsx`
- Modify: `src/components/till/OrderPanel.jsx`

## Component: `CashPaymentModal`

**Props:** `total: number`, `onConfirm: () => void`, `onCancel: () => void`

Renders as a full-screen overlay (fixed inset-0, dark backdrop) on top of the till.

### Step 1 — Entry

- Header: "Cash Payment" with the order total (e.g. £7.50)
- Quick-select row: £5, £10, £20, £50 buttons — tapping sets the tendered amount
- Large touch numpad: digits 0–9, decimal point, backspace
- Amount display: shows the tendered amount being entered (e.g. £10.00)
- Live change preview: "Change: £2.50" — hidden/grey until tendered ≥ total
- Confirm button: disabled when tendered < total; enabled once the order is covered
- Cancel button: dismisses modal, returns to till

### Step 2 — Change due

- Large prominent display: "Give change" label + change amount in green (e.g. £2.50)
- Single "Done" button: calls `onConfirm` → `handleCheckout('cash')` → order clears
- No editing — cashier must cancel and re-open to correct a mistake

## OrderPanel changes

The Cash button's `onClick` sets local state `showCashModal: true` instead of calling `handleCheckout('cash')` directly.

```jsx
const [showCashModal, setShowCashModal] = useState(false)

// Cash button onClick:
onClick={() => setShowCashModal(true)}

// Render:
{showCashModal && (
  <CashPaymentModal
    total={total}
    onConfirm={() => { setShowCashModal(false); handleCheckout('cash') }}
    onCancel={() => setShowCashModal(false)}
  />
)}
```

## Tests

- Entry step renders with total displayed
- Quick-select buttons set the tendered amount
- Numpad input builds amount correctly
- Confirm button disabled when tendered < total
- Confirm button enabled when tendered ≥ total
- Change amount calculated correctly
- Confirming transitions to change-due step
- Change-due step displays correct change
- Done button calls onConfirm
- Cancel button calls onCancel
