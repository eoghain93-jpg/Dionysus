# Staff PIN Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add staff PIN login to the Dionysus EPOS till. Each staff member has a 4-digit PIN. The till shows a full-screen PIN entry screen on load (and after Z report). Entering a valid PIN sets the active staff session. Privileged actions (void order, refund, Z report, member tier change) require PIN confirmation via an inline `PinGate` modal. Staff PINs are set/changed from the Members page.

**Architecture:**
- DB migration: `pin_hash text` column on `members`
- Edge function: `supabase/functions/verify-pin/index.ts` — verify mode and set mode
- Zustand store: `src/stores/sessionStore.js` — `activeStaff`, `setActiveStaff`, `clearSession`
- Component: `src/components/till/PinLoginScreen.jsx` — full-screen login, shown when `activeStaff` is null
- Component: `src/components/till/PinGate.jsx` — inline modal for privileged action confirmation
- Wire-up: `src/pages/TillPage.jsx` wraps existing till content with `PinLoginScreen`
- Set PIN UI: `src/components/members/SetPinModal.jsx` + button in `src/components/members/MemberProfile.jsx`

**Tech Stack:** React 19 + Vite 7, Vitest 4 + @testing-library/react 16, Tailwind CSS 4, lucide-react, Zustand 5, Supabase JS v2. Edge functions use Deno + `https://deno.land/std@0.168.0/http/server.ts`. Test runner: `export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run`. Currently 147 tests passing across 35 test files — every task must leave tests green.

---

## Codebase orientation

Key patterns to follow throughout this plan:

**Zustand stores** (`src/stores/tillStore.js`):
```js
import { create } from 'zustand'
export const useXxxStore = create((set, get) => ({ ... }))
```
Tests call `useXxxStore.setState({...})` in `beforeEach` to reset, and `useXxxStore.getState().action()` to exercise logic.

**Component tests** (`src/components/till/CashPaymentModal.test.jsx`):
- Import `{ render, screen, fireEvent }` from `@testing-library/react`
- `vi.fn()` for callbacks, `beforeEach` to `.mockClear()`
- Never wrap in a Router unless the component uses navigation

**Supabase mock in tests** (`src/components/till/MemberLookup.test.jsx`):
```js
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))
```

**Edge functions** (`supabase/functions/invite-member/index.ts`):
- `import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'`
- `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`
- Use `Deno.env.get('SUPABASE_URL')!` etc.
- Service-role client for DB writes, no JWT auth needed for till-internal calls in this feature
- Always return `new Response(JSON.stringify(...), { status: N, headers: { 'Content-Type': 'application/json' } })`

**Numpad pattern** (`src/components/till/CashPaymentModal.jsx`):
```jsx
const NUMPAD_KEYS = ['1','2','3','4','5','6','7','8','9','00','0','back']
// rendered as a grid-cols-3 of buttons; 'back' renders <Delete size={20} />
```

**Icon imports** — always import from `lucide-react` directly (not from `../../lib/icons`) in till components:
```js
import { Delete, User, Lock, CheckCircle } from 'lucide-react'
```

**Tailwind colour palette in use:**
- Page/panel bg: `bg-slate-900`, `bg-slate-800`, `bg-[#0F172A]`
- Borders: `border-slate-700`, `border-slate-800`
- Primary action: `bg-emerald-700 hover:bg-emerald-600`
- Danger: `text-red-400`, `bg-red-400/10`
- Text: `text-white`, `text-slate-400`, `text-slate-300`

---

## Task 1 — DB migration: add `pin_hash` column

### File to create
`supabase/migrations/20260330_staff_pin.sql`

### Why this comes first
All other tasks depend on the DB column existing. The migration is plain SQL with no JS, no tests, and no risk to existing tests.

### Step 1.1 — Write the migration file

Create `supabase/migrations/20260330_staff_pin.sql`:

```sql
-- supabase/migrations/20260330_staff_pin.sql
-- Add hashed PIN storage for staff members.
-- Nullable: only staff members need a PIN. Regular members leave this null.
alter table members add column if not exists pin_hash text;
```

### Step 1.2 — Apply to local Supabase (if running locally)

```bash
supabase db push
```

If local Supabase is not running, the migration will be applied next time the project is pushed/deployed. This does not block any subsequent tasks — the edge function and frontend code are all written against the column existing.

### Step 1.3 — Verify existing tests still pass

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected output:
```
Test Files  35 passed (35)
Tests       147 passed (147)
```

The migration is pure SQL and has no effect on JS tests.

### Commit

```bash
git add supabase/migrations/20260330_staff_pin.sql
git commit -m "feat: add pin_hash column to members table"
```

---

## Task 2 — Edge function: `verify-pin`

### Files to create
- `supabase/functions/verify-pin/index.ts`

### Overview

The edge function handles two modes dispatched by the `mode` field in the request body:

| mode | Input | What it does | Response |
|------|-------|--------------|----------|
| `verify` (default) | `{ member_id, pin }` | Checks tier=staff, bcrypt-compares PIN hash | `{ valid: true, member: { id, name } }` or `{ valid: false }` |
| `set` | `{ member_id, pin, mode: 'set' }` | Bcrypt-hashes the PIN, writes `pin_hash` to members row | `{ success: true }` or `{ error }` |

**Security model:** The till operates without Supabase Auth (it's a kiosk, not a user-facing app). The edge function uses the Supabase service-role key for all DB operations. The till calls this function directly using the anon key in `supabase.functions.invoke(...)` which is acceptable for an internal kiosk system. If future hardening is needed, add IP-allowlisting or a shared secret header.

**bcrypt:** Deno does not have a native bcrypt module in the standard library. Use `https://deno.land/x/bcrypt@v0.4.1/mod.ts` which is stable and widely used in Deno edge functions.

### Step 2.1 — Write the edge function

Create `supabase/functions/verify-pin/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: CORS_HEADERS },
    )
  }

  let body: { member_id?: string; pin?: string; mode?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const { member_id, pin, mode = 'verify' } = body

  if (!member_id || !pin) {
    return new Response(
      JSON.stringify({ error: 'member_id and pin are required' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  // PIN must be exactly 4 digits
  if (!/^\d{4}$/.test(pin)) {
    return new Response(
      JSON.stringify({ error: 'PIN must be exactly 4 digits' }),
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- SET MODE ---
  if (mode === 'set') {
    const hash = await bcrypt.hash(pin)
    const { error } = await supabase
      .from('members')
      .update({ pin_hash: hash })
      .eq('id', member_id)
      .eq('membership_tier', 'staff')

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: CORS_HEADERS },
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // --- VERIFY MODE (default) ---
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('id, name, pin_hash, membership_tier')
    .eq('id', member_id)
    .single()

  if (fetchError || !member) {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // Only staff members can log in
  if (member.membership_tier !== 'staff') {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  // No PIN set yet
  if (!member.pin_hash) {
    return new Response(
      JSON.stringify({ valid: false }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  const valid = await bcrypt.compare(pin, member.pin_hash)

  if (valid) {
    return new Response(
      JSON.stringify({ valid: true, member: { id: member.id, name: member.name } }),
      { status: 200, headers: CORS_HEADERS },
    )
  }

  return new Response(
    JSON.stringify({ valid: false }),
    { status: 200, headers: CORS_HEADERS },
  )
})
```

### Step 2.2 — Manual smoke test (optional, requires local Supabase)

If Supabase is running locally:

```bash
# Set a PIN
curl -X POST http://localhost:54321/functions/v1/verify-pin \
  -H "Content-Type: application/json" \
  -d '{"member_id":"<your-staff-member-uuid>","pin":"1234","mode":"set"}'
# Expected: {"success":true}

# Verify correct PIN
curl -X POST http://localhost:54321/functions/v1/verify-pin \
  -H "Content-Type: application/json" \
  -d '{"member_id":"<your-staff-member-uuid>","pin":"1234"}'
# Expected: {"valid":true,"member":{"id":"...","name":"..."}}

# Verify wrong PIN
curl -X POST http://localhost:54321/functions/v1/verify-pin \
  -H "Content-Type: application/json" \
  -d '{"member_id":"<your-staff-member-uuid>","pin":"9999"}'
# Expected: {"valid":false}
```

### Step 2.3 — Verify JS tests still pass

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected output:
```
Test Files  35 passed (35)
Tests       147 passed (147)
```

The edge function is Deno TypeScript; it has no effect on the Vitest suite.

### Commit

```bash
git add supabase/functions/verify-pin/index.ts
git commit -m "feat: verify-pin edge function (verify + set modes, bcrypt)"
```

---

## Task 3 — `sessionStore` (Zustand store + tests)

### Files to create
- `src/stores/sessionStore.js`
- `src/stores/sessionStore.test.js`

### Overview

`sessionStore` tracks the currently logged-in staff member for the till session. It is in-memory only — no `persist` middleware — so the session ends on page reload or when `clearSession()` is explicitly called (e.g. after running the Z report).

Shape:
```
{
  activeStaff: { id: string, name: string } | null
  setActiveStaff(member: { id, name }): void
  clearSession(): void
}
```

### Step 3.1 — Write the failing tests first

Create `src/stores/sessionStore.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from './sessionStore'

// Reset store state before each test
beforeEach(() => {
  useSessionStore.setState({ activeStaff: null })
})

describe('sessionStore', () => {
  it('initialises with no active staff', () => {
    const { activeStaff } = useSessionStore.getState()
    expect(activeStaff).toBeNull()
  })

  it('setActiveStaff sets the active staff member', () => {
    const staff = { id: 'staff-1', name: 'Alice' }
    useSessionStore.getState().setActiveStaff(staff)
    expect(useSessionStore.getState().activeStaff).toEqual(staff)
  })

  it('setActiveStaff only stores id and name', () => {
    // Extra fields (e.g. pin_hash) must not leak into the store
    const staff = { id: 'staff-2', name: 'Bob', pin_hash: 'secret', membership_tier: 'staff' }
    useSessionStore.getState().setActiveStaff(staff)
    const stored = useSessionStore.getState().activeStaff
    expect(stored).toEqual({ id: 'staff-2', name: 'Bob' })
    expect(stored.pin_hash).toBeUndefined()
    expect(stored.membership_tier).toBeUndefined()
  })

  it('clearSession resets activeStaff to null', () => {
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Alice' } })
    useSessionStore.getState().clearSession()
    expect(useSessionStore.getState().activeStaff).toBeNull()
  })

  it('overwriting active staff replaces the previous session', () => {
    useSessionStore.getState().setActiveStaff({ id: 'staff-1', name: 'Alice' })
    useSessionStore.getState().setActiveStaff({ id: 'staff-2', name: 'Bob' })
    expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-2', name: 'Bob' })
  })
})
```

### Step 3.2 — Run: expect 5 failures

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
FAIL  src/stores/sessionStore.test.js
  sessionStore
    × initialises with no active staff
    × setActiveStaff sets the active staff member
    × setActiveStaff only stores id and name
    × clearSession resets activeStaff to null
    × overwriting active staff replaces the previous session

Test Files  1 failed | 35 passed (36)
Tests       5 failed | 147 passed (152)
```

(The import itself will fail with "Cannot find module './sessionStore'" — that is the expected red state.)

### Step 3.3 — Write the implementation

Create `src/stores/sessionStore.js`:

```js
import { create } from 'zustand'

export const useSessionStore = create((set) => ({
  activeStaff: null,

  // Only store the minimum fields — never persist pin_hash or other sensitive data
  setActiveStaff: (member) =>
    set({ activeStaff: { id: member.id, name: member.name } }),

  clearSession: () => set({ activeStaff: null }),
}))
```

### Step 3.4 — Run: expect all tests green

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  36 passed (36)
Tests       152 passed (152)
```

### Commit

```bash
git add src/stores/sessionStore.js src/stores/sessionStore.test.js
git commit -m "feat: sessionStore — in-memory staff session (Zustand)"
```

---

## Task 4 — `PinLoginScreen` component with tests

### Files to create
- `src/components/till/PinLoginScreen.jsx`
- `src/components/till/PinLoginScreen.test.jsx`

### Overview

Full-screen overlay shown when `activeStaff` is null. Contains:
1. A `<select>` listing all staff members fetched from Supabase (`membership_tier = 'staff'`)
2. A 4-digit PIN numpad (9 digits + backspace, no 00 key unlike CashPaymentModal)
3. A dot-display showing how many digits have been entered (● filled, ○ empty)
4. Error message on invalid PIN
5. Auto-submits when 4 digits are entered, calls `supabase.functions.invoke('verify-pin', ...)`
6. On success: calls `setActiveStaff` from `sessionStore`

**PIN numpad keys for this component:**
```js
const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']
```
- `back` removes last digit
- `clear` resets all digits (maps to an `X` icon or "Clear" label)

### Step 4.1 — Write the failing tests first

Create `src/components/till/PinLoginScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PinLoginScreen from './PinLoginScreen'
import { useSessionStore } from '../../stores/sessionStore'

// ── Supabase mock ──────────────────────────────────────────────────────────────
const mockInvoke = vi.fn()
const mockFrom = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    functions: { invoke: mockInvoke },
  },
}))

// ── Default staff member list returned by Supabase ────────────────────────────
const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

function setupFromMock(staffList = STAFF) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: staffList, error: null }),
  })
}

// ── Reset state before each test ───────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: null })
  setupFromMock()
})

describe('PinLoginScreen', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders a staff selector', async () => {
    render(<PinLoginScreen />)
    expect(await screen.findByRole('combobox', { name: /staff member/i })).toBeInTheDocument()
  })

  it('populates the dropdown with staff members from Supabase', async () => {
    render(<PinLoginScreen />)
    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument()
  })

  it('renders 12 numpad buttons', async () => {
    render(<PinLoginScreen />)
    // Wait for staff to load (component renders numpad after mount)
    await screen.findByRole('combobox', { name: /staff member/i })
    // 1-9 + back + 0 + clear = 12 buttons
    const numpadButtons = screen.getAllByRole('button').filter(
      btn => /^[0-9]$/.test(btn.textContent) || btn.getAttribute('aria-label') === 'Backspace' || btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  it('renders 4 PIN dots initially all empty', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    // aria-label="PIN display" contains 4 empty dot characters
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Numpad interaction ─────────────────────────────────────────────────────
  it('pressing digit fills a dot', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(3)
  })

  it('backspace removes the last digit', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /backspace/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('clear resets all digits', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    fireEvent.click(screen.getByRole('button', { name: /clear pin/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('cannot enter more than 4 digits', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    ;['1', '2', '3', '4', '5'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(4)
  })

  // ── Auto-submit on 4th digit ───────────────────────────────────────────────
  it('auto-submits when 4 digits are entered with a staff member selected', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: { id: 'staff-1', name: 'Alice' } },
      error: null,
    })

    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })

    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234' },
      })
    })
  })

  it('does not submit if no staff member is selected', async () => {
    render(<PinLoginScreen />)
    await screen.findByRole('combobox', { name: /staff member/i })
    // Enter 4 digits without selecting a staff member (default = '')
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    // Should not call invoke
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  // ── Success path ───────────────────────────────────────────────────────────
  it('on valid PIN calls setActiveStaff and clears digits', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: { id: 'staff-1', name: 'Alice' } },
      error: null,
    })

    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )

    await waitFor(() => {
      expect(useSessionStore.getState().activeStaff).toEqual({ id: 'staff-1', name: 'Alice' })
    })
  })

  // ── Failure path ───────────────────────────────────────────────────────────
  it('on invalid PIN shows error message and clears digits', async () => {
    mockInvoke.mockResolvedValue({ data: { valid: false }, error: null })

    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    // Digits should be cleared so staff can try again
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('on network error shows generic error message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network error' } })

    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  // ── Loading state ──────────────────────────────────────────────────────────
  it('shows a loading indicator while verifying', async () => {
    // Never resolve — keeps spinner visible
    mockInvoke.mockReturnValue(new Promise(() => {}))

    render(<PinLoginScreen />)
    const select = await screen.findByRole('combobox', { name: /staff member/i })
    fireEvent.change(select, { target: { value: 'staff-1' } })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )

    expect(await screen.findByText(/verifying/i)).toBeInTheDocument()
  })

  // ── Empty staff list ───────────────────────────────────────────────────────
  it('shows a message when no staff members exist', async () => {
    setupFromMock([])
    render(<PinLoginScreen />)
    expect(await screen.findByText(/no staff members/i)).toBeInTheDocument()
  })
})
```

### Step 4.2 — Run: expect all PinLoginScreen tests to fail

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
FAIL  src/components/till/PinLoginScreen.test.jsx
  PinLoginScreen
    × renders a staff selector
    × populates the dropdown with staff members from Supabase
    ... (all 14 tests failing)

Test Files  1 failed | 36 passed (37)
Tests       14 failed | 152 passed (166)
```

### Step 4.3 — Write the implementation

Create `src/components/till/PinLoginScreen.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { Delete, X, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'

// PIN numpad layout: 1-9, then backspace / 0 / clear
const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

export default function PinLoginScreen() {
  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)

  const { setActiveStaff } = useSessionStore()

  // Load staff members on mount
  useEffect(() => {
    supabase
      .from('members')
      .select('id, name, membership_tier')
      .eq('membership_tier', 'staff')
      .order('name')
      .then(({ data }) => {
        setStaffList(data ?? [])
        setLoadingStaff(false)
      })
      .catch(() => setLoadingStaff(false))
  }, [])

  // Auto-submit when 4 digits entered and a staff member is selected
  useEffect(() => {
    if (digits.length === 4 && selectedId) {
      handleVerify(selectedId, digits)
    }
  }, [digits, selectedId])

  function handleKey(key) {
    if (verifying) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => d.length < 4 ? d + key : d)
    }
  }

  async function handleVerify(memberId, pin) {
    setVerifying(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: memberId, pin },
      })

      if (invokeError || !data) {
        setError('Something went wrong. Please try again.')
        setDigits('')
        return
      }

      if (data.valid) {
        setActiveStaff(data.member)
        // Component will unmount once activeStaff is set (parent hides it)
      } else {
        setError('Incorrect PIN. Please try again.')
        setDigits('')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center">
            <Lock size={32} className="text-slate-400" aria-hidden="true" />
          </div>
          <h1 className="text-white text-2xl font-bold">Staff Login</h1>
          <p className="text-slate-400 text-sm">Select your name and enter your PIN</p>
        </div>

        {/* Staff selector */}
        {loadingStaff ? (
          <div className="text-slate-400 text-sm text-center">Loading staff…</div>
        ) : staffList.length === 0 ? (
          <p className="text-slate-400 text-sm text-center">
            No staff members found. Add a staff member in the Members page.
          </p>
        ) : (
          <div className="space-y-1">
            <label
              htmlFor="pin-staff-select"
              className="block text-sm font-medium text-slate-300"
            >
              Staff Member
            </label>
            <select
              id="pin-staff-select"
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setDigits(''); setError(null) }}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white
                min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              aria-label="Staff Member"
            >
              <option value="">— Select staff member —</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* PIN dot display */}
        <div
          aria-label="PIN display"
          className="flex justify-center gap-4"
        >
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              data-filled={i < digits.length ? 'true' : 'false'}
              className={`w-4 h-4 rounded-full transition-colors duration-150 ${
                i < digits.length ? 'bg-white' : 'bg-slate-600'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Verifying indicator */}
        {verifying && (
          <p className="text-center text-slate-400 text-sm">Verifying…</p>
        )}

        {/* Error message */}
        {error && (
          <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
            {error}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {PIN_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={verifying}
              aria-label={
                key === 'back' ? 'Backspace' :
                key === 'clear' ? 'Clear PIN' :
                key
              }
              className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40
                disabled:cursor-not-allowed text-white font-semibold py-5 rounded-2xl text-2xl
                transition-all duration-150 cursor-pointer flex items-center justify-center
                border border-slate-700"
            >
              {key === 'back' && <Delete size={22} aria-hidden="true" />}
              {key === 'clear' && <X size={22} aria-hidden="true" />}
              {key !== 'back' && key !== 'clear' && key}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

### Step 4.4 — Run: expect all tests green

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  37 passed (37)
Tests       166 passed (166)
```

### Commit

```bash
git add src/components/till/PinLoginScreen.jsx src/components/till/PinLoginScreen.test.jsx
git commit -m "feat: PinLoginScreen — staff selector + PIN numpad with verify-pin integration"
```

---

## Task 5 — `PinGate` component with tests

### Files to create
- `src/components/till/PinGate.jsx`
- `src/components/till/PinGate.test.jsx`

### Overview

`PinGate` is a modal overlay that requires PIN re-entry before a privileged action is allowed. It does NOT change the session — it simply re-verifies the currently logged-in `activeStaff` member's PIN before calling `onConfirm`. This prevents one staff member from using another's session for privileged actions.

Props:
```
onConfirm: () => void   — called only after PIN verified
onCancel: () => void    — called if user dismisses
label?: string          — action description shown in modal header (e.g. "Void Order")
```

The component reads `activeStaff` from `sessionStore` to know which member_id to verify against.

### Step 5.1 — Write the failing tests first

Create `src/components/till/PinGate.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PinGate from './PinGate'
import { useSessionStore } from '../../stores/sessionStore'

// ── Supabase mock ──────────────────────────────────────────────────────────────
const mockInvoke = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────
const ACTIVE_STAFF = { id: 'staff-1', name: 'Alice' }

function renderGate(props = {}) {
  return render(
    <PinGate
      onConfirm={props.onConfirm ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
      label={props.label}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState({ activeStaff: ACTIVE_STAFF })
})

describe('PinGate', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders the active staff name', () => {
    renderGate()
    expect(screen.getByText(/alice/i)).toBeInTheDocument()
  })

  it('renders the action label when provided', () => {
    renderGate({ label: 'Void Order' })
    expect(screen.getByText(/void order/i)).toBeInTheDocument()
  })

  it('renders a default header when no label provided', () => {
    renderGate()
    expect(screen.getByRole('heading')).toHaveTextContent(/confirm identity/i)
  })

  it('renders 4 PIN dots initially all empty', () => {
    renderGate()
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('renders 12 numpad buttons', () => {
    renderGate()
    const numpadButtons = screen.getAllByRole('button').filter(
      btn =>
        /^[0-9]$/.test(btn.textContent) ||
        btn.getAttribute('aria-label') === 'Backspace' ||
        btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  // ── Numpad interaction ─────────────────────────────────────────────────────
  it('pressing digit fills a dot', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('backspace removes last digit', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: /backspace/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="true"]')).toHaveLength(1)
  })

  it('clear resets all digits', () => {
    renderGate()
    ;['1', '2', '3'].forEach(d => fireEvent.click(screen.getByRole('button', { name: d })))
    fireEvent.click(screen.getByRole('button', { name: /clear pin/i }))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Auto-submit ────────────────────────────────────────────────────────────
  it('auto-submits when 4 digits are entered', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: ACTIVE_STAFF },
      error: null,
    })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234' },
      })
    })
  })

  // ── Success path ───────────────────────────────────────────────────────────
  it('calls onConfirm after successful PIN verify', async () => {
    const onConfirm = vi.fn()
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: ACTIVE_STAFF },
      error: null,
    })
    renderGate({ onConfirm })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  })

  it('does NOT change the session store on success', async () => {
    mockInvoke.mockResolvedValue({
      data: { valid: true, member: ACTIVE_STAFF },
      error: null,
    })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    // Session must remain unchanged
    expect(useSessionStore.getState().activeStaff).toEqual(ACTIVE_STAFF)
  })

  // ── Failure path ───────────────────────────────────────────────────────────
  it('shows error and clears digits on invalid PIN', async () => {
    mockInvoke.mockResolvedValue({ data: { valid: false }, error: null })
    renderGate()
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect pin/i)
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  it('shows generic error on network failure', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Network error' } })
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  // ── Cancel ─────────────────────────────────────────────────────────────────
  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    renderGate({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  // ── Verifying state ────────────────────────────────────────────────────────
  it('shows verifying indicator while awaiting response', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))
    renderGate()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/verifying/i)).toBeInTheDocument()
  })
})
```

### Step 5.2 — Run: expect all PinGate tests to fail

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
FAIL  src/components/till/PinGate.test.jsx
  PinGate
    × renders the active staff name
    ... (all 16 tests failing)

Test Files  1 failed | 37 passed (38)
Tests       16 failed | 166 passed (182)
```

### Step 5.3 — Write the implementation

Create `src/components/till/PinGate.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { Delete, X, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/**
 * PinGate — require PIN re-entry before a privileged action.
 *
 * Does NOT change the session. Calls onConfirm() only after successful verify.
 *
 * Props:
 *   onConfirm  — () => void, called after PIN verified
 *   onCancel   — () => void, called when user dismisses
 *   label      — string, action name shown in header (optional)
 */
export default function PinGate({ onConfirm, onCancel, label }) {
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)

  const activeStaff = useSessionStore(s => s.activeStaff)

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (digits.length === 4 && activeStaff) {
      handleVerify(activeStaff.id, digits)
    }
  }, [digits])

  function handleKey(key) {
    if (verifying) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => d.length < 4 ? d + key : d)
    }
  }

  async function handleVerify(memberId, pin) {
    setVerifying(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: memberId, pin },
      })

      if (invokeError || !data) {
        setError('Something went wrong. Please try again.')
        setDigits('')
        return
      }

      if (data.valid) {
        onConfirm()
      } else {
        setError('Incorrect PIN. Please try again.')
        setDigits('')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-slate-400" aria-hidden="true" />
            <h2 className="text-white text-lg font-bold">
              {label ?? 'Confirm Identity'}
            </h2>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer
              min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Staff name */}
        {activeStaff && (
          <p className="text-slate-400 text-sm">
            Enter PIN for <span className="text-white font-semibold">{activeStaff.name}</span>
          </p>
        )}

        {/* PIN dot display */}
        <div
          aria-label="PIN display"
          className="flex justify-center gap-4 py-2"
        >
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              data-filled={i < digits.length ? 'true' : 'false'}
              className={`w-4 h-4 rounded-full transition-colors duration-150 ${
                i < digits.length ? 'bg-white' : 'bg-slate-600'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Verifying */}
        {verifying && (
          <p className="text-center text-slate-400 text-sm">Verifying…</p>
        )}

        {/* Error */}
        {error && (
          <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
            {error}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {PIN_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={verifying}
              aria-label={
                key === 'back' ? 'Backspace' :
                key === 'clear' ? 'Clear PIN' :
                key
              }
              className="bg-slate-700 hover:bg-slate-600 active:scale-95 disabled:opacity-40
                disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-xl
                transition-all duration-150 cursor-pointer flex items-center justify-center"
            >
              {key === 'back' && <Delete size={20} aria-hidden="true" />}
              {key === 'clear' && <X size={20} aria-hidden="true" />}
              {key !== 'back' && key !== 'clear' && key}
            </button>
          ))}
        </div>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold
            py-3 rounded-xl transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
```

### Step 5.4 — Run: expect all tests green

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  38 passed (38)
Tests       182 passed (182)
```

### Commit

```bash
git add src/components/till/PinGate.jsx src/components/till/PinGate.test.jsx
git commit -m "feat: PinGate — inline PIN confirmation modal for privileged actions"
```

---

## Task 6 — Wire `PinLoginScreen` into the till app

### Files to modify
- `src/pages/TillPage.jsx`

### Overview

Wrap the existing till content with a conditional: if `activeStaff` is null, show `PinLoginScreen` instead of the till. `PinLoginScreen` calls `setActiveStaff` on success, which triggers a re-render and reveals the till.

No new test file needed — the existing `TillPage` doesn't have its own test file. The `PinLoginScreen` tests already verify the component's behaviour in isolation. What we add here is a simple conditional render in a page component.

However, we DO need to update the tests for any component that now depends on `sessionStore` being in a non-null state (none do currently — `PinLoginScreen` and `PinGate` are self-contained).

### Step 6.1 — Modify `TillPage.jsx`

The only change is:
1. Import `useSessionStore` and `PinLoginScreen`
2. If `activeStaff` is null, return `<PinLoginScreen />`
3. Otherwise render the existing till content unchanged

Read the current file content first (already done above), then apply the edit:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { fetchProducts } from '../lib/products'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useTillStore } from '../stores/tillStore'
import { useSyncStore } from '../stores/syncStore'
import { useSessionStore } from '../stores/sessionStore'
import CategoryFilter from '../components/till/CategoryFilter'
import ProductGrid from '../components/till/ProductGrid'
import OrderPanel from '../components/till/OrderPanel'
import MemberLookup from '../components/till/MemberLookup'
import PinLoginScreen from '../components/till/PinLoginScreen'

export default function TillPage() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const { orderItems, activeMember, clearOrder } = useTillStore()
  const { isOnline } = useSyncStore()
  const { activeStaff } = useSessionStore()

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
  }, [])

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
        await supabase.from('order_items').insert(items.map(i => ({ ...i, order_id: data.id })))
        if (paymentMethod === 'tab' && currentMember) {
          await supabase.from('members')
            .update({ tab_balance: (currentMember.tab_balance || 0) + total })
            .eq('id', currentMember.id)
        }
      }
    } else {
      await db.pendingOrders.add({ order, items })
    }

    clearOrder()
  }, [isOnline, clearOrder])

  // Show PIN login screen when no staff session is active
  if (!activeStaff) {
    return <PinLoginScreen />
  }

  const filtered = category === 'all' ? products : products.filter(p => p.category === category)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 overflow-auto flex-1">
          <MemberLookup />
          <CategoryFilter active={category} onChange={setCategory} />
          {loading
            ? <div className="text-slate-400 text-sm">Loading products…</div>
            : filtered.length === 0
              ? <div className="text-slate-400 text-sm">No products in this category</div>
              : <ProductGrid products={filtered} />}
        </div>
      </div>
      <div className="hidden md:flex">
        <OrderPanel onCheckout={handleCheckout} />
      </div>
    </div>
  )
}
```

### Step 6.2 — Verify existing tests still pass

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  38 passed (38)
Tests       182 passed (182)
```

`TillPage` has no test file of its own, so no test changes are needed. All other tests are isolated and unaffected.

### Step 6.3 — Manual browser verification

Open the till app in the browser. Expected:
1. The PIN login screen appears immediately (full-screen, `activeStaff` starts null)
2. Select a staff member, enter correct PIN → till appears normally
3. Refresh the page → PIN screen appears again (session is in-memory only)

### Commit

```bash
git add src/pages/TillPage.jsx
git commit -m "feat: gate TillPage behind PinLoginScreen when no active staff session"
```

---

## Task 7 — "Set PIN" UI on member profile page

### Files to create
- `src/components/members/SetPinModal.jsx`
- `src/components/members/SetPinModal.test.jsx`

### Files to modify
- `src/components/members/MemberProfile.jsx`

### Overview

Staff members need a way to set/change their PIN. The UI is:
1. A "Set PIN" button in `MemberProfile` — only shown when `member.membership_tier === 'staff'`
2. Clicking it opens `SetPinModal`
3. `SetPinModal` has two sequential 4-digit PIN entries (enter new PIN, then confirm)
4. If both match, calls `supabase.functions.invoke('verify-pin', { body: { member_id, pin, mode: 'set' } })`
5. On success: shows a brief success message, then closes
6. On mismatch: shows "PINs do not match"

The modal uses the same numpad pattern as `PinGate` and `PinLoginScreen` (grid-cols-3, large touch buttons).

### Step 7.1 — Write the failing tests first

Create `src/components/members/SetPinModal.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetPinModal from './SetPinModal'

// ── Supabase mock ──────────────────────────────────────────────────────────────
const mockInvoke = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}))

const STAFF_MEMBER = { id: 'staff-1', name: 'Alice', membership_tier: 'staff' }

function renderModal(props = {}) {
  return render(
    <SetPinModal
      member={props.member ?? STAFF_MEMBER}
      onClose={props.onClose ?? vi.fn()}
      onSaved={props.onSaved ?? vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SetPinModal', () => {
  // ── Rendering ──────────────────────────────────────────────────────────────
  it('renders a heading with the member name', () => {
    renderModal()
    expect(screen.getByRole('heading')).toHaveTextContent(/alice/i)
  })

  it('renders step 1 prompt initially', () => {
    renderModal()
    expect(screen.getByText(/enter new pin/i)).toBeInTheDocument()
  })

  it('renders 12 numpad buttons', () => {
    renderModal()
    const numpadButtons = screen.getAllByRole('button').filter(
      btn =>
        /^[0-9]$/.test(btn.textContent) ||
        btn.getAttribute('aria-label') === 'Backspace' ||
        btn.getAttribute('aria-label') === 'Clear PIN'
    )
    expect(numpadButtons).toHaveLength(12)
  })

  it('renders 4 empty PIN dots on mount', () => {
    renderModal()
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Step 1 — enter new PIN ─────────────────────────────────────────────────
  it('advances to step 2 after 4 digits entered in step 1', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(screen.getByText(/confirm new pin/i)).toBeInTheDocument()
    })
  })

  it('clears dots when advancing to step 2', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    const display = screen.getByLabelText(/PIN display/i)
    expect(display.querySelectorAll('[data-filled="false"]')).toHaveLength(4)
  })

  // ── Step 2 — confirm PIN ───────────────────────────────────────────────────
  it('shows mismatch error when confirmation does not match', async () => {
    renderModal()
    // Step 1: enter 1234
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    // Step 2: enter 5678
    ;['5', '6', '7', '8'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/pins do not match/i)
  })

  it('goes back to step 1 after a mismatch', async () => {
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['9', '9', '9', '9'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(screen.getByText(/enter new pin/i)).toBeInTheDocument()
    })
  })

  // ── Matching PINs — calls edge function ────────────────────────────────────
  it('calls verify-pin with set mode when PINs match', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null })
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('verify-pin', {
        body: { member_id: 'staff-1', pin: '1234', mode: 'set' },
      })
    })
  })

  it('shows success message and calls onSaved after successful set', async () => {
    const onSaved = vi.fn()
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null })
    renderModal({ onSaved })
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByText(/pin set successfully/i)).toBeInTheDocument()
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce(), { timeout: 2500 })
  })

  it('shows error message on edge function failure', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Server error' } })
    renderModal()
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    await waitFor(() => screen.getByText(/confirm new pin/i))
    ;['1', '2', '3', '4'].forEach(d =>
      fireEvent.click(screen.getByRole('button', { name: d }))
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to set pin/i)
  })

  // ── Cancel / close ─────────────────────────────────────────────────────────
  it('Cancel button calls onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

### Step 7.2 — Run: expect all SetPinModal tests to fail

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
FAIL  src/components/members/SetPinModal.test.jsx
  SetPinModal
    × renders a heading with the member name
    ... (all 14 tests failing)

Test Files  1 failed | 38 passed (39)
Tests       14 failed | 182 passed (196)
```

### Step 7.3 — Write the implementation

Create `src/components/members/SetPinModal.jsx`:

```jsx
import { useState, useEffect, useId, useRef } from 'react'
import { Delete, X, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/**
 * SetPinModal — allows a staff member's PIN to be set or changed.
 *
 * Two-step flow:
 *   Step 1: Enter new 4-digit PIN
 *   Step 2: Confirm PIN (re-enter)
 * If both match, calls verify-pin edge function in 'set' mode.
 *
 * Props:
 *   member    — member object (must be membership_tier === 'staff')
 *   onClose   — () => void
 *   onSaved   — () => void, called after PIN is successfully set
 */
export default function SetPinModal({ member, onClose, onSaved }) {
  const titleId = useId()
  const overlayRef = useRef(null)

  const [step, setStep] = useState(1)       // 1 = enter, 2 = confirm
  const [firstPin, setFirstPin] = useState('')
  const [digits, setDigits] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Escape to close
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  function handleKey(key) {
    if (saving || success) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => {
        const next = d.length < 4 ? d + key : d
        // Auto-advance when 4th digit is pressed
        if (next.length === 4) {
          // Use setTimeout so state updates settle before we advance
          setTimeout(() => handleFourDigits(next), 0)
        }
        return next
      })
    }
  }

  function handleFourDigits(pin) {
    if (step === 1) {
      setFirstPin(pin)
      setDigits('')
      setStep(2)
    } else {
      // Step 2 — compare
      if (pin === firstPin) {
        handleSave(pin)
      } else {
        setError('PINs do not match. Please try again.')
        setDigits('')
        setFirstPin('')
        setStep(1)
      }
    }
  }

  async function handleSave(pin) {
    setSaving(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: member.id, pin, mode: 'set' },
      })

      if (invokeError || !data?.success) {
        setError('Failed to set PIN. Please try again.')
        setDigits('')
        setFirstPin('')
        setStep(1)
        return
      }

      setSuccess(true)
      // Give a brief moment for the user to see the success message
      setTimeout(() => onSaved(), 1500)
    } catch {
      setError('Failed to set PIN. Please try again.')
      setDigits('')
      setFirstPin('')
      setStep(1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-slate-400" aria-hidden="true" />
            <h2
              id={titleId}
              className="text-lg font-bold text-white"
              style={{ fontFamily: "'Playfair Display SC', serif" }}
            >
              Set PIN — {member.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer
              min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Step indicator */}
          <p className="text-slate-300 text-sm text-center">
            {success
              ? 'PIN set successfully!'
              : step === 1
                ? 'Enter new PIN'
                : 'Confirm new PIN'}
          </p>

          {/* PIN dot display */}
          <div
            aria-label="PIN display"
            className="flex justify-center gap-4"
          >
            {[0, 1, 2, 3].map(i => (
              <span
                key={i}
                data-filled={i < digits.length ? 'true' : 'false'}
                className={`w-4 h-4 rounded-full transition-colors duration-150 ${
                  i < digits.length ? 'bg-white' : 'bg-slate-600'
                }`}
                aria-hidden="true"
              />
            ))}
          </div>

          {/* Saving indicator */}
          {saving && (
            <p className="text-center text-slate-400 text-sm">Saving…</p>
          )}

          {/* Error */}
          {error && (
            <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
              {error}
            </p>
          )}

          {/* Numpad */}
          {!success && (
            <div className="grid grid-cols-3 gap-2">
              {PIN_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  disabled={saving || success}
                  aria-label={
                    key === 'back' ? 'Backspace' :
                    key === 'clear' ? 'Clear PIN' :
                    key
                  }
                  className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40
                    disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-xl
                    transition-all duration-150 cursor-pointer flex items-center justify-center
                    border border-slate-700"
                >
                  {key === 'back' && <Delete size={20} aria-hidden="true" />}
                  {key === 'clear' && <X size={20} aria-hidden="true" />}
                  {key !== 'back' && key !== 'clear' && key}
                </button>
              ))}
            </div>
          )}

          {/* Cancel */}
          {!success && (
            <button
              onClick={onClose}
              disabled={saving}
              className="w-full min-h-[44px] rounded-xl border border-slate-600 text-slate-300
                hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Step 7.4 — Run: expect SetPinModal tests green

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  39 passed (39)
Tests       196 passed (196)
```

### Step 7.5 — Add "Set PIN" button to MemberProfile

Modify `src/components/members/MemberProfile.jsx`:

1. Add `useState` for `setPinOpen` (already has `useState` imported)
2. Import `SetPinModal` and `KeyRound` icon
3. Add "Set PIN" button in the footer actions (only visible for `staff` tier members)
4. Render `SetPinModal` conditionally

**Changes to make** (exact diff):

At the top of the file, add the `KeyRound` icon to the existing lucide import:
```jsx
// Change this line:
import { X, Clock, Phone, Mail, Calendar, Star, CreditCard } from '../../lib/icons'
// To:
import { X, Clock, Phone, Mail, Calendar, Star, CreditCard, KeyRound } from '../../lib/icons'
```

Note: Check if `KeyRound` is available in the project's `src/lib/icons.js`. If it's a re-export barrel, add `KeyRound` there too. If `MemberProfile` imports directly from lucide-react for some icons, import `KeyRound` from `lucide-react`.

After the `SettleTabModal` import, add:
```jsx
import SetPinModal from './SetPinModal'
```

Inside the component, after the `settleModalOpen` state declaration, add:
```jsx
const [setPinOpen, setSetPinOpen] = useState(false)
```

In the footer actions `<div>`, after the "Settle Tab" button and before the "Edit Member" button, add:
```jsx
{member.membership_tier === 'staff' && (
  <button
    onClick={() => setSetPinOpen(true)}
    className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-slate-700 hover:bg-slate-600
      text-white font-semibold text-sm transition-colors cursor-pointer focus:outline-none
      focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
  >
    <KeyRound size={16} aria-hidden="true" />
    Set PIN
  </button>
)}
```

After the `SettleTabModal` conditional render block, add:
```jsx
{setPinOpen && (
  <SetPinModal
    member={member}
    onClose={() => setSetPinOpen(false)}
    onSaved={() => setSetPinOpen(false)}
  />
)}
```

### Step 7.6 — Check icons.js for KeyRound

Before editing `MemberProfile.jsx`, check what `src/lib/icons.js` exports to know whether to import `KeyRound` from there or directly from `lucide-react`.

If `icons.js` is a barrel re-exporting from lucide-react, add `KeyRound` to it. If `MemberProfile` already imports some icons directly from `lucide-react`, import `KeyRound` from `lucide-react` in `MemberProfile.jsx`.

```bash
# Check current icons.js
cat src/lib/icons.js
```

If `icons.js` re-exports everything:
```js
// Add KeyRound to icons.js exports
export { ..., KeyRound } from 'lucide-react'
```

Then in `MemberProfile.jsx` the existing `../../lib/icons` import gains `KeyRound`.

### Step 7.7 — Run all tests

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected:
```
Test Files  39 passed (39)
Tests       196 passed (196)
```

### Commit

```bash
git add src/components/members/SetPinModal.jsx \
        src/components/members/SetPinModal.test.jsx \
        src/components/members/MemberProfile.jsx \
        src/lib/icons.js
git commit -m "feat: Set PIN modal and button on staff member profile"
```

---

## Final verification

Run the full test suite one last time to confirm the complete feature is green:

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected final output:
```
Test Files  39 passed (39)
Tests       196 passed (196)
Duration    ~3s
```

All 196 tests pass (147 original + 49 new across 4 new test files).

---

## Summary of all files changed

| Action | File |
|--------|------|
| CREATE | `supabase/migrations/20260330_staff_pin.sql` |
| CREATE | `supabase/functions/verify-pin/index.ts` |
| CREATE | `src/stores/sessionStore.js` |
| CREATE | `src/stores/sessionStore.test.js` |
| CREATE | `src/components/till/PinLoginScreen.jsx` |
| CREATE | `src/components/till/PinLoginScreen.test.jsx` |
| CREATE | `src/components/till/PinGate.jsx` |
| CREATE | `src/components/till/PinGate.test.jsx` |
| MODIFY | `src/pages/TillPage.jsx` |
| CREATE | `src/components/members/SetPinModal.jsx` |
| CREATE | `src/components/members/SetPinModal.test.jsx` |
| MODIFY | `src/components/members/MemberProfile.jsx` |
| MODIFY (maybe) | `src/lib/icons.js` |

## New test count breakdown

| File | Tests |
|------|-------|
| `sessionStore.test.js` | 5 |
| `PinLoginScreen.test.jsx` | 14 |
| `PinGate.test.jsx` | 16 |
| `SetPinModal.test.jsx` | 14 |
| **Total new** | **49** |
| **Grand total** | **196** |
