# Star mC-Print3 Printer & Cash Drawer Integration — Design Spec

**Date:** 2026-04-06
**Project:** Dionysus POS — The Fairmile Sports & Social Club
**Hardware:** Star mC-Print3 (MCP31CI) with RJ11 cash drawer

---

## Overview

Integrate receipt printing and cash drawer control into the Dionysus POS via Star WebPRNT over Ethernet. The browser sends an HTTP POST with XML to the printer's local IP. No npm packages required — native `fetch()` only.

---

## Trigger Matrix

| Event | Print Receipt | Open Drawer |
|---|---|---|
| Cash payment | Yes | Yes (via print job) |
| Card payment | Yes | No |
| Tab payment | Yes | No |
| Cashback | No | Yes (separate call) |
| Manual open (Settings) | No | Yes |

---

## Architecture

### Files Created

**`src/lib/starPrinter.js`**
Pure functions, no React. Three exports:
- `getPrinterIp()` — reads `localStorage.getItem('printer_ip')`, returns `null` if unset
- `printReceipt({ orderId, total, paymentMethod, createdAt })` — builds and sends WebPRNT XML; includes drawer pulse for cash payments
- `openDrawer()` — sends drawer-only WebPRNT XML; used by Settings page and cashback flow

**`src/pages/SettingsPage.jsx`**
Printer configuration page at `/settings`. Any logged-in staff can access.

**`src/hooks/useToast.js`**
Zustand store: `toasts` array, `addToast(message, type)`, `removeToast(id)`. Auto-removes after 4 seconds.

**`src/components/ui/Toast.jsx`**
Fixed position, bottom-right, above mobile nav bar. Error toasts (`bg-red-900 border-red-700`), success toasts (green-tinted). Dismiss on click. One toast visible at a time.

### Files Modified

- `src/pages/TillPage.jsx` — call `printReceipt` after checkout; catch errors and `addToast`
- `src/components/till/CashbackModal.jsx` — call `openDrawer` after `recordCashback` succeeds; catch errors and `addToast`
- `src/App.jsx` — add `/settings` route
- `src/components/NavBar.jsx` — add Settings link using `Settings` icon from lucide-react

---

## Config Storage

Printer IP stored in `localStorage` under key `printer_ip`. Runtime-configurable, no backend required. Appropriate for a single fixed terminal.

**Simulation mode:** When no IP is set, `printReceipt` and `openDrawer` log the XML to `console.info` and return without throwing. This allows the app to run without a printer connected.

---

## `src/lib/starPrinter.js` — Detail

### `printReceipt({ orderId, total, paymentMethod, createdAt })`

Builds a Star WebPRNT XML document and POSTs to `http://{ip}/StarWebPRNT/SendMessage` with `Content-Type: application/xml`.

Receipt layout:
```
  THE FAIRMILE SPORTS & SOCIAL CLUB

  06/04/2026  14:32
  Receipt #A1B2C3D4          ← last 8 chars of order UUID
  Cash

  TOTAL: £12.50

  Thank you for your visit
  [feed + cut]
```

- `orderId`: last 8 characters of the Supabase UUID displayed as receipt number
- `paymentMethod`: capitalised — "Cash", "Card", "Tab"
- `createdAt`: formatted as `DD/MM/YYYY  HH:MM`
- Cash payments: drawer pulse appended to the same XML document (DK port, standard Star WebPRNT pulse). Single HTTP request — avoids race condition between print and drawer open.
- Throws on non-2xx HTTP response so the caller can catch and toast.

### `openDrawer()`

Sends minimal WebPRNT XML containing only the drawer pulse. Used by:
1. Settings page "Open Drawer" button
2. `CashbackModal` after `recordCashback()` succeeds

Same simulation-mode behaviour as `printReceipt`.

---

## `TillPage.handleCheckout` — Modified Flow

```
handleCheckout(paymentMethod)
  → save order to Supabase → receive { data: { id } }
  → try:
      await printReceipt({ orderId: data.id, total, paymentMethod, createdAt: order.created_at })
    catch:
      addToast('Print failed — check printer connection', 'error')
  → clearOrder()   ← always runs, never blocked by print failure
```

Offline path (IndexedDB): no order ID is available. Use a timestamp-based reference: `'OFF-' + Date.now()`. Print still fires — simulation mode will handle it gracefully if offline means no printer either.

---

## `CashbackModal` — Modified Flow

```
handleSubmit()
  → recordCashback(amount, staff_id)    ← existing
  → try:
      await openDrawer()
    catch:
      addToast('Drawer failed — use manual open in Settings', 'error')
  → onSaved()
```

Drawer failure does not roll back or block the cashback record.

---

## `src/pages/SettingsPage.jsx` — Detail

Single-section page, dark slate UI consistent with existing style.

**Printer IP input:**
- Pre-populated from `localStorage` on mount
- Save button: writes to `localStorage`, shows inline "Saved ✓" confirmation

**Test Connection button:**
- Calls `printReceipt` with dummy data
- Inline success: "Test print sent"
- Inline error: "Connection failed — check IP and printer power"
- No IP set: "Simulation mode — no IP configured"

**Open Drawer button:**
- Calls `openDrawer()`
- Inline success: "Drawer opened"
- Inline error: "Failed to open drawer"

Errors shown inline (not toast) — user is actively watching the Settings page.

---

## `src/components/NavBar.jsx` — Settings Link

Added to the `links` array using the `Settings` icon from lucide-react:

```js
{ to: '/settings', label: 'Settings', Icon: Settings }
```

Follows the identical pattern as all existing nav links. Visible on both sidebar (tablet/desktop) and bottom tab bar (mobile).

---

## Toast System

**`src/hooks/useToast.js`**
```js
// Zustand store
{
  toasts: [],
  addToast: (message, type) => ...,  // auto-removes after 4s
  removeToast: (id) => ...
}
```

**`src/components/ui/Toast.jsx`**
- Fixed bottom-right, `z-50`, with `mb-16` clearance for mobile nav bar
- Queue: oldest shown first; disappears after 4s or on click
- Error: `bg-red-900 border border-red-700 text-white`
- Success: `bg-emerald-900 border border-emerald-700 text-white`
- Rendered in `Layout` so it's available on all pages

---

## Testing

### `src/lib/starPrinter.test.js`
- Simulation mode (no IP): resolves without throwing, logs to console
- `printReceipt` with IP: mocks `fetch`, asserts POST URL, XML contains club name, total, receipt number, payment method
- Cash payment: asserts drawer pulse XML present in request
- Card/Tab payment: asserts drawer pulse XML absent
- `openDrawer`: mocks `fetch`, asserts drawer-only XML sent
- Non-2xx response: asserts function throws

### `src/pages/SettingsPage.test.jsx`
- Save writes IP to `localStorage`
- Input pre-populated from `localStorage` on mount
- Test Connection calls `printReceipt` (mocked)
- Open Drawer calls `openDrawer` (mocked)
- Inline error shown when call throws
- No IP set shows simulation mode message

### Existing tests
No changes needed to existing `TillPage` tests — `printReceipt` mocked at module level.

---

## Error Handling Summary

| Failure | User sees | Transaction |
|---|---|---|
| Print fails (any payment) | Toast: "Print failed — check printer connection" | Completes normally |
| Drawer fails (cash payment) | Toast: "Print failed — check printer connection" | Completes normally |
| Drawer fails (cashback) | Toast: "Drawer failed — use manual open in Settings" | Cashback recorded |
| Drawer fails (Settings manual open) | Inline error on Settings page | N/A |

---

## Out of Scope

- Itemised receipts
- Staff name on receipt
- Printer status polling
- Multiple till support
- Printer IP per-till (single terminal only)
