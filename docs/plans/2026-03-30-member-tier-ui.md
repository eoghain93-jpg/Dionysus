# Member Tier UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static tier display on `MemberProfile` with an interactive dropdown that lets staff change a member's tier (`member` | `staff`) with an inline Supabase update, gated behind a PIN confirmation via `<PinGate>`.

**Architecture:** All changes are contained within `MemberProfile.jsx`. A new `updateMemberTier` function is added to `src/lib/members.js`. A new `<PinGate>` component is created at `src/components/members/PinGate.jsx`. `MemberProfile` holds local state for the pending tier selection and whether the PinGate modal is open. On PIN confirmation the tier is written to Supabase and the local member state is updated optimistically. No changes to `tillStore`, `MembersPage`, or till pricing logic are required.

**Tech Stack:** React, Vitest, @testing-library/react, Tailwind CSS, Supabase

---

### Task 1: `updateMemberTier` in `src/lib/members.js` — tests and implementation

**Files:**
- Modify: `src/lib/members.js`
- Modify: existing members lib test (or create new test file `src/lib/members.test.js`)

There is no existing test file for `src/lib/members.js`. Create one.

**Step 1: Write the failing test**

```js
// src/lib/members.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateMemberTier } from './members'

// Mirror the supabase mock pattern used in MemberLookup.test.jsx
vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

// db is used in other members.js functions — mock it to avoid Dexie setup
vi.mock('./db', () => ({
  db: {
    members: {
      put: vi.fn().mockResolvedValue(undefined),
      bulkPut: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue(null) }) }),
      filter: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    },
  },
}))

vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: vi.fn().mockReturnValue({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { db } from './db'

describe('updateMemberTier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls supabase update with the correct id and tier', async () => {
    const updatedMember = { id: 'm1', name: 'Alice', membership_tier: 'staff' }
    const single = vi.fn().mockResolvedValue({ data: updatedMember, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    supabase.from.mockReturnValue({ update })

    const result = await updateMemberTier('m1', 'staff')

    expect(supabase.from).toHaveBeenCalledWith('members')
    expect(update).toHaveBeenCalledWith({ membership_tier: 'staff' })
    expect(eq).toHaveBeenCalledWith('id', 'm1')
    expect(result).toEqual(updatedMember)
  })

  it('writes the updated member to the local db cache', async () => {
    const updatedMember = { id: 'm1', name: 'Alice', membership_tier: 'member' }
    const single = vi.fn().mockResolvedValue({ data: updatedMember, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    supabase.from.mockReturnValue({ update })

    await updateMemberTier('m1', 'member')

    expect(db.members.put).toHaveBeenCalledWith(updatedMember)
  })

  it('throws when supabase returns an error', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const select = vi.fn().mockReturnValue({ single })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    supabase.from.mockReturnValue({ update })

    await expect(updateMemberTier('m1', 'staff')).rejects.toEqual({ message: 'DB error' })
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: 3 new failures — `updateMemberTier is not a function` (or similar import error).

**Step 3: Implement `updateMemberTier` in `src/lib/members.js`**

Add the following export at the end of the file, after `settleTab`:

```js
export async function updateMemberTier(id, tier) {
  const { data, error } = await supabase
    .from('members')
    .update({ membership_tier: tier })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await db.members.put(data)
  return data
}
```

**Step 4: Run tests to confirm the 3 new tests pass**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all 147 + 3 = 150 tests pass.

**Step 5: Commit**

```bash
git add src/lib/members.js src/lib/members.test.js
git commit -m "feat: add updateMemberTier to members lib"
```

---

### Task 2: `<PinGate>` component — tests and implementation

`PinGate` is a modal that renders over its surroundings and calls `onConfirm` when the user clicks a confirm button (in tests this is faked as a simple button; in production it will be a PIN entry UI). It renders its children below a PIN prompt, or it can be used as a standalone gate modal.

The design doc specifies that in tests, `PinGate` should be mocked as:
```jsx
vi.mock('./PinGate', () => ({ default: ({ onConfirm }) => <button onClick={onConfirm}>Confirm PIN</button> }))
```

This means the real `PinGate` component must:
1. Accept `onConfirm` and `onCancel` props
2. Render a modal that calls `onConfirm()` when the PIN is accepted
3. Call `onCancel()` if dismissed

Because Staff PIN Login (`PinGate` full implementation) is a separate future feature, the real component for this task is a **stub** that presents a simple modal with a confirm and cancel button (no actual PIN entry). This satisfies the contract expected by `MemberProfile` and can be upgraded later.

**Files:**
- Create: `src/components/members/PinGate.jsx`
- Create: `src/components/members/__tests__/PinGate.test.jsx`

**Step 1: Write the failing tests**

```jsx
// src/components/members/__tests__/PinGate.test.jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PinGate from '../PinGate'

describe('PinGate', () => {
  it('renders the modal with a confirm and cancel button', () => {
    render(<PinGate onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('displays a descriptive heading', () => {
    render(<PinGate onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /confirm action/i })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<PinGate onConfirm={onConfirm} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<PinGate onConfirm={vi.fn()} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders an optional prompt message', () => {
    render(<PinGate onConfirm={vi.fn()} onCancel={vi.fn()} prompt="Change member tier?" />)
    expect(screen.getByText('Change member tier?')).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: 5 new failures — `PinGate` module not found.

**Step 3: Implement `PinGate`**

```jsx
// src/components/members/PinGate.jsx

/**
 * PinGate — stub modal for PIN-gated actions.
 * Presents a confirm/cancel dialog. Will be upgraded to full PIN entry
 * when the Staff PIN Login feature is implemented.
 *
 * Props:
 *   onConfirm  — called when the user confirms
 *   onCancel   — called when the user dismisses/cancels
 *   prompt     — optional descriptive string shown in the modal body
 */
export default function PinGate({ onConfirm, onCancel, prompt }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-gate-title"
    >
      <div className="w-full max-w-xs bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl p-6 flex flex-col gap-4">
        <h2
          id="pin-gate-title"
          className="text-white font-bold text-lg text-center"
          style={{ fontFamily: "'Playfair Display SC', serif" }}
        >
          Confirm Action
        </h2>

        {prompt && (
          <p className="text-slate-300 text-sm text-center">{prompt}</p>
        )}

        <p className="text-slate-400 text-xs text-center">
          Staff authorisation required.
        </p>

        <div className="flex gap-3 mt-2">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 min-h-[44px] rounded-xl bg-[#3B82F6] hover:bg-blue-400 text-white font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Run tests to confirm the 5 new tests pass**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all 150 + 5 = 155 tests pass.

**Step 5: Commit**

```bash
git add src/components/members/PinGate.jsx src/components/members/__tests__/PinGate.test.jsx
git commit -m "feat: add PinGate stub component"
```

---

### Task 3: Tier dropdown on `MemberProfile` with inline DB update and PinGate — tests and implementation

The existing `MemberProfile` displays the tier as static text:
```jsx
<p className="text-white capitalize">{member.membership_tier ?? 'member'}</p>
```

This is replaced with a `<select>` dropdown. When the user changes the value, a `PinGate` modal opens. On confirmation the tier is saved to Supabase via `updateMemberTier`, the local member state is updated, and an `onTierChanged` callback is fired so the parent can refresh its list. On cancellation nothing changes.

`MemberProfile` receives local state for `currentTier` (initialised from `member.membership_tier`) so the dropdown reflects the latest value even before the parent re-renders.

**Files:**
- Modify: `src/components/members/MemberProfile.jsx`
- Create: `src/components/members/__tests__/MemberProfile.test.jsx`

**Step 1: Write the failing tests**

```jsx
// src/components/members/__tests__/MemberProfile.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MemberProfile from '../MemberProfile'

// ── Supabase mock ─────────────────────────────────────────────────────────────
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

// ── Members lib mock ──────────────────────────────────────────────────────────
vi.mock('../../../lib/members', () => ({
  updateMemberTier: vi.fn(),
}))

// ── PinGate mock (per design doc) ─────────────────────────────────────────────
vi.mock('../PinGate', () => ({
  default: ({ onConfirm }) => (
    <button onClick={onConfirm}>Confirm PIN</button>
  ),
}))

import { supabase } from '../../../lib/supabase'
import { updateMemberTier } from '../../../lib/members'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockOrdersQuery(orders = []) {
  // supabase.from('orders').select(...).eq(...).eq(...).order(...).limit(...)
  const then = (cb) => { cb({ data: orders }); return { catch: () => ({ finally: (f) => f() }) } }
  const limit = vi.fn().mockReturnValue({ then })
  const order = vi.fn().mockReturnValue({ limit })
  const eq2 = vi.fn().mockReturnValue({ order })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select }
}

const baseMember = {
  id: 'm1',
  name: 'Alice Brennan',
  membership_number: 'M0001',
  membership_tier: 'member',
  tab_balance: 0,
  renewal_date: null,
  phone: null,
  email: null,
  favourite_drinks: [],
  notes: null,
}

const noop = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  supabase.from.mockReturnValue(mockOrdersQuery())
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MemberProfile — tier dropdown', () => {
  it('renders a tier dropdown with the current tier selected', () => {
    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    const select = screen.getByRole('combobox', { name: /tier/i })
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('member')
  })

  it('renders both Member and Staff options', () => {
    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    const select = screen.getByRole('combobox', { name: /tier/i })
    const options = Array.from(select.options).map(o => o.value)
    expect(options).toContain('member')
    expect(options).toContain('staff')
  })

  it('defaults to "member" when membership_tier is null', () => {
    const member = { ...baseMember, membership_tier: null }
    render(
      <MemberProfile member={member} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    expect(screen.getByRole('combobox', { name: /tier/i }).value).toBe('member')
  })

  it('shows the PinGate when the dropdown value changes', async () => {
    const user = userEvent.setup()
    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    // PinGate mock renders a "Confirm PIN" button
    expect(screen.getByRole('button', { name: /confirm pin/i })).toBeInTheDocument()
  })

  it('calls updateMemberTier with the correct id and tier on PIN confirm', async () => {
    const user = userEvent.setup()
    updateMemberTier.mockResolvedValue({ ...baseMember, membership_tier: 'staff' })

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    expect(updateMemberTier).toHaveBeenCalledWith('m1', 'staff')
  })

  it('updates the dropdown to the new tier after confirmation', async () => {
    const user = userEvent.setup()
    updateMemberTier.mockResolvedValue({ ...baseMember, membership_tier: 'staff' })

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /tier/i }).value).toBe('staff')
    })
  })

  it('dismisses the PinGate after confirmation', async () => {
    const user = userEvent.setup()
    updateMemberTier.mockResolvedValue({ ...baseMember, membership_tier: 'staff' })

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /confirm pin/i })).not.toBeInTheDocument()
    })
  })

  it('reverts the dropdown to original tier when PinGate is cancelled', async () => {
    const user = userEvent.setup()

    // Re-mock PinGate for this test to expose both confirm and cancel
    // We need to test cancel — override the module mock for this test
    // by adding an onCancel prop to the mock's render
    // Note: the default mock only exposes onConfirm, so we need a cancel button too.
    // The mock is: ({ onConfirm }) => <button onClick={onConfirm}>Confirm PIN</button>
    // To test cancel we check that WITHOUT confirming the dropdown reverts.
    // We achieve this by not clicking Confirm and instead triggering the cancel path.
    //
    // The cleanest approach: override the mock in this test with vi.doMock is complex.
    // Instead, extend the mock at module level to also expose onCancel (see mock definition
    // at the top of this file — update it to include a Cancel button).
    //
    // UPDATED MODULE MOCK (replace the mock at top of file with):
    //   vi.mock('../PinGate', () => ({
    //     default: ({ onConfirm, onCancel }) => (
    //       <>
    //         <button onClick={onConfirm}>Confirm PIN</button>
    //         <button onClick={onCancel}>Cancel PIN</button>
    //       </>
    //     ),
    //   }))

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /cancel pin/i }))

    // Dropdown reverts to original value
    expect(screen.getByRole('combobox', { name: /tier/i }).value).toBe('member')
    // PinGate is dismissed
    expect(screen.queryByRole('button', { name: /cancel pin/i })).not.toBeInTheDocument()
    // updateMemberTier was never called
    expect(updateMemberTier).not.toHaveBeenCalled()
  })

  it('calls onTierChanged callback after a successful tier update', async () => {
    const user = userEvent.setup()
    const onTierChanged = vi.fn()
    updateMemberTier.mockResolvedValue({ ...baseMember, membership_tier: 'staff' })

    render(
      <MemberProfile
        member={baseMember}
        onClose={noop}
        onEdit={noop}
        onSettleTab={noop}
        onTierChanged={onTierChanged}
      />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    await waitFor(() => {
      expect(onTierChanged).toHaveBeenCalledOnce()
    })
  })

  it('shows an error message when updateMemberTier throws', async () => {
    const user = userEvent.setup()
    updateMemberTier.mockRejectedValue(new Error('Network error'))

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('reverts dropdown to original value if updateMemberTier throws', async () => {
    const user = userEvent.setup()
    updateMemberTier.mockRejectedValue(new Error('Network error'))

    render(
      <MemberProfile member={baseMember} onClose={noop} onEdit={noop} onSettleTab={noop} />
    )
    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'staff')
    await user.click(screen.getByRole('button', { name: /confirm pin/i }))

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /tier/i }).value).toBe('member')
    })
  })
})
```

> **Note on the cancel test (test 7):** The `PinGate` mock at the top of the file must expose both `onConfirm` and `onCancel`. Use this mock definition throughout:
> ```jsx
> vi.mock('../PinGate', () => ({
>   default: ({ onConfirm, onCancel }) => (
>     <>
>       <button onClick={onConfirm}>Confirm PIN</button>
>       <button onClick={onCancel}>Cancel PIN</button>
>     </>
>   ),
> }))
> ```

**Step 2: Run tests to confirm they fail**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: 10 new failures — the dropdown does not exist yet.

**Step 3: Implement the tier dropdown in `MemberProfile`**

The following changes are required in `src/components/members/MemberProfile.jsx`:

**3a. Add imports** at the top of the file, after the existing imports:

```jsx
import { useState } from 'react'  // already imported — add to existing destructure
import PinGate from './PinGate'
import { updateMemberTier } from '../../lib/members'
```

Note: `useState` is already imported — add `PinGate` and `updateMemberTier` to the existing imports.

**3b. Add state inside the component function** (after the existing `useState` declarations):

```jsx
const [currentTier, setCurrentTier] = useState(member.membership_tier ?? 'member')
const [pendingTier, setPendingTier] = useState(null)  // non-null means PinGate is open
const [tierError, setTierError] = useState(null)
```

**3c. Add the handler functions** (after the existing `formatCurrency` helper):

```jsx
function handleTierChange(e) {
  const newTier = e.target.value
  if (newTier === currentTier) return
  setTierError(null)
  setPendingTier(newTier)
}

async function handleTierConfirm() {
  try {
    await updateMemberTier(member.id, pendingTier)
    setCurrentTier(pendingTier)
    onTierChanged?.()
  } catch {
    setTierError('Failed to update tier. Please try again.')
    // revert — pendingTier is discarded, currentTier unchanged
  } finally {
    setPendingTier(null)
  }
}

function handleTierCancel() {
  setPendingTier(null)
}
```

**3d. Replace the static tier display** in the JSX. Find:

```jsx
<div>
  <p className="text-slate-400 text-xs mb-0.5 flex items-center gap-1">
    <Star size={12} aria-hidden="true" /> Tier
  </p>
  <p className="text-white capitalize">{member.membership_tier ?? 'member'}</p>
</div>
```

Replace with:

```jsx
<div>
  <label
    htmlFor="member-tier-select"
    className="text-slate-400 text-xs mb-0.5 flex items-center gap-1"
  >
    <Star size={12} aria-hidden="true" /> Tier
  </label>
  <select
    id="member-tier-select"
    value={currentTier}
    onChange={handleTierChange}
    aria-label="Tier"
    className="bg-[#020617] border border-slate-600 rounded-lg text-white text-sm px-2 py-1 capitalize cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
  >
    <option value="member">Member</option>
    <option value="staff">Staff</option>
  </select>
  {tierError && (
    <p role="alert" className="text-red-400 text-xs mt-1">{tierError}</p>
  )}
</div>
```

**3e. Add the PinGate modal and update the component signature** — two changes:

First, update the function signature to accept `onTierChanged`:

```jsx
export default function MemberProfile({ member, onClose, onEdit, onSettleTab, onTierChanged }) {
```

Second, add the `PinGate` render just before the closing `</div>` of the outer overlay wrapper (after the `SettleTabModal` block):

```jsx
{pendingTier && (
  <PinGate
    onConfirm={handleTierConfirm}
    onCancel={handleTierCancel}
    prompt={`Change tier to ${pendingTier}?`}
  />
)}
```

**Step 4: Run tests to confirm all new tests pass**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all 155 + 10 = 165 tests pass.

**Step 5: Commit**

```bash
git add src/components/members/MemberProfile.jsx src/components/members/__tests__/MemberProfile.test.jsx
git commit -m "feat: tier dropdown on MemberProfile with PinGate and inline DB update"
```

---

### Task 4: Wire `onTierChanged` in `MembersPage`

When a tier changes via the profile overlay, the member list should refresh so the tier is reflected if the user re-opens the profile.

**Files:**
- Modify: `src/pages/MembersPage.jsx`

There are no tests to write for this task — it is a one-line wiring change in the parent, and the profile's own behaviour is already tested. The existing `loadMembers` callback is the correct refresh function.

**Step 1: Add `onTierChanged` prop to `MemberProfile` in `MembersPage`**

In `src/pages/MembersPage.jsx`, find the `MemberProfile` usage:

```jsx
<MemberProfile
  member={profileMember}
  onClose={() => setProfileMember(null)}
  onEdit={member => {
    setProfileMember(null)
    openEdit(member)
  }}
  onSettleTab={handleTabSettled}
/>
```

Replace with:

```jsx
<MemberProfile
  member={profileMember}
  onClose={() => setProfileMember(null)}
  onEdit={member => {
    setProfileMember(null)
    openEdit(member)
  }}
  onSettleTab={handleTabSettled}
  onTierChanged={loadMembers}
/>
```

**Step 2: Run all tests**

```bash
export PATH="/c/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64:$PATH" && npm test -- --run
```

Expected: all 165 tests still pass (no tests broken by this prop addition).

**Step 3: Commit**

```bash
git add src/pages/MembersPage.jsx
git commit -m "feat: refresh member list on tier change from profile"
```

---

## Summary of all files changed

| File | Action |
|---|---|
| `src/lib/members.js` | Add `updateMemberTier` export |
| `src/lib/members.test.js` | New — 3 tests for `updateMemberTier` |
| `src/components/members/PinGate.jsx` | New — stub modal component |
| `src/components/members/__tests__/PinGate.test.jsx` | New — 5 tests for `PinGate` |
| `src/components/members/MemberProfile.jsx` | Replace static tier display with dropdown + PinGate |
| `src/components/members/__tests__/MemberProfile.test.jsx` | New — 10 tests for tier dropdown behaviour |
| `src/pages/MembersPage.jsx` | Wire `onTierChanged={loadMembers}` |

**Final expected test count: 147 + 3 + 5 + 10 = 165 passing tests.**
