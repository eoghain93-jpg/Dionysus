# Refunds — Design

## Goal

Cashiers can refund a completed order from today's transactions. Refund requires PIN confirmation. Payment reversal is automatic per method: cash prompts the amount to hand back, card triggers a Stripe refund, tab credits the member's balance.

## Database

Add `refunded_at` and `refunded_by` columns to the `orders` table:

```sql
alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists refunded_by uuid references members(id);
```

A non-null `refunded_at` means the order is refunded. Refunded orders are excluded from Z report revenue but appear as negative lines.

## Architecture

**Refunds UI**
- "Refund" button in the till, accessible from a new "Orders" panel showing today's completed, non-refunded orders
- Selecting an order shows its items and total
- PIN gate confirms the action (`<PinGate>` from staff PIN login feature)
- After PIN confirmation, refund flow branches by payment method:
  - **Cash** → CashRefundModal: shows "Hand back £X.XX" (same style as change modal), Done records the refund
  - **Card** → calls `process-refund` edge function → Stripe API reversal → records refund on success
  - **Tab** → credits amount back to member's `tab_balance` via RPC, records refund

**New edge function: `process-refund`**
- Accepts `{ order_id, staff_member_id }`
- Looks up order, verifies not already refunded
- For card: calls `stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })`
- Updates `orders` with `refunded_at`, `refunded_by`
- Returns `{ success: true }` or `{ error }`

## Refunds in Z Report

Refunded orders appear as a negative subtotal per payment method in the Z report. Cash refunds reduce expected cash in the till.
