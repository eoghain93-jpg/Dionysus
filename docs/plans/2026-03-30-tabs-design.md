# Tabs Page — Design

## Goal

Staff can see all members with outstanding tab balances in one place, view the breakdown of what was ordered, and quickly settle tabs by cash or card.

## Database

No schema changes. Tab balance is stored on `members.tab_balance`. Tab orders are in `orders` where `payment_method = 'tab'` for a given `member_id`, with line items in `order_items`.

## Data Layer

New file `src/lib/tabs.js` with two functions:

```js
// Fetch all members with tab_balance > 0, ordered by balance descending
fetchOpenTabs() → member[]

// Fetch tab orders + items for a specific member
fetchTabOrders(member_id) → order[]   // each order includes order_items
```

## TabsPage

**Route:** `/tabs`

**Layout:**
- Header: "Tabs" heading + total outstanding balance across all open tabs
- List of members with open tabs, each row showing:
  - Member name
  - Outstanding balance (large, prominent)
  - Tap to expand: inline order breakdown (date, items, subtotals)
  - **Settle** button → opens existing `SettleTabModal`
- After settlement: row animates out / disappears
- Empty state: "No open tabs" message

## Navigation

- New `/tabs` route in `App.jsx`
- `Receipt` icon added to `NavBar` between Members and Promos
- `Receipt` added to `src/lib/icons.js` (already exported — verify)

## Reuse

`SettleTabModal` from `src/components/members/SettleTabModal.jsx` is reused as-is. No changes needed to the settle flow.

## Testing

- `src/lib/tabs.test.js` — unit tests for `fetchOpenTabs` and `fetchTabOrders` with Supabase mocks
- `src/pages/TabsPage.test.jsx` — component tests:
  - Renders list of open tabs
  - Shows total outstanding balance
  - Expands row to show order breakdown
  - Opens SettleTabModal on Settle click
  - Removes member row after settlement
  - Shows empty state when no tabs
  - Shows loading state initially
