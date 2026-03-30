# Staff PIN Login — Design

## Goal

Each staff member has a 4-digit PIN. The till shows a PIN entry screen on load. Entering a valid PIN sets the active staff member for the session. PIN is required to perform privileged actions: void orders, issue refunds, open the Z report, and change member tiers.

## Database

Add `pin` column to `members` table (hashed, nullable — only staff members need a PIN):

```sql
alter table members add column if not exists pin_hash text;
```

PIN hashing: bcrypt via a Supabase edge function. The till never stores or transmits plain PINs — it sends the PIN to a `verify-pin` edge function which returns a session token.

## Architecture

**New edge function: `verify-pin`**
- Accepts `{ member_id, pin }`
- Looks up member, checks `membership_tier = 'staff'`, compares PIN hash
- Returns `{ valid: true, member: { id, name } }` or `{ valid: false }`

**Till store: `sessionStore`**
- `activeStaff: { id, name } | null`
- `setActiveStaff(member)` / `clearSession()`
- Persists in memory only (not localStorage — session ends on page reload or Z report)

**PIN entry screen**
- Shown on till load when `activeStaff` is null
- Large touch numpad (reuse numpad pattern from CashPaymentModal)
- Staff member selector (dropdown or list) so the PIN is associated with the right person
- On success: sets `activeStaff` in store, reveals the till

**Privileged action gate**
- Reusable `<PinGate>` component: renders a PIN modal before allowing a protected action
- Used inline: void order, refund, Z report, member tier change
- Does not change the session — just confirms identity for that action

## PIN Management

Staff PINs set and changed via the Members page — a "Set PIN" button on staff member profiles opens a PIN entry modal (enter new PIN twice to confirm). This calls the `verify-pin` edge function's set mode.

## Session end

Running the Z report calls `clearSession()` on the store, returning the till to the PIN entry screen.
