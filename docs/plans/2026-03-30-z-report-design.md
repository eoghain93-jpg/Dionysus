# Z Report (End of Day) — Design

## Goal

A PIN-gated end-of-day report showing full sales summary and cash reconciliation for a selected date. Running it emails the report to the manager, locks the till, and requires fresh PIN login to start a new session.

## Access

- Available from the Reports page
- Requires PIN entry via `<PinGate>` before opening
- Defaults to today's date; manager can select any past date for historical reports

## Report Sections

### 1. Sales Summary
- Total revenue for the day
- Transaction count (excluding refunds)
- Breakdown by payment method: Cash / Card / Tab
- Refunds total (shown as negative, broken down by method)
- Net revenue (total - refunds)

### 2. Top Products
- Top 10 products by revenue for the selected date
- Name, quantity sold, revenue

### 3. Cash Reconciliation
- **Opening float** — manager enters the float amount at start of day (input field, editable)
- **Cash sales** — pulled from orders (cash payments, minus cash refunds)
- **Expected in till** — opening float + cash sales
- **Actual cash** — manager counts and enters the amount physically in the till
- **Variance** — expected minus actual, highlighted green (over) or red (under)

## Actions

- **Export CSV** — downloads the full report
- **Close Day** — emails the report to `MANAGER_EMAIL`, marks the date as reconciled in a new `z_reports` table, clears `sessionStore` (locks till)

## Database

New `z_reports` table to track reconciled days and store the opening float:

```sql
create table z_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  opening_float numeric(10,2) not null default 0,
  actual_cash numeric(10,2),
  closed_at timestamptz,
  closed_by uuid references members(id)
);
```

## Email

Sent via `send-z-report` edge function. Plain text or simple HTML email containing all three sections. Same `MANAGER_EMAIL` env var as low stock alerts.

## Session lock

On "Close Day": `sessionStore.clearSession()` → till returns to PIN entry screen.
