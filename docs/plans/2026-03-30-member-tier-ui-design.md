# Member Tier UI — Design

## Goal

Staff can change a member's tier (Member or Staff) from the member profile page. Both tiers receive member pricing at the till. Non-members pay standard price.

## Tiers

- **Member** — has a membership card, pays member price
- **Staff** — employee, pays member price (same as member)
- **Non-member** — walk-in, pays standard price (no record in system)

## Changes

**Member profile page**
- Replace any static tier display with a dropdown: `Member | Staff`
- Changing the value immediately updates `membership_tier` in the DB (no save button — inline update)
- Change is PIN-gated via `<PinGate>` (staff tier grants system access, so it needs authorisation)

**Till pricing logic**
- Already applies member price when `activeMember` is set
- No change needed — both Member and Staff tiers use `member_price`
- Non-members (no active member selected) use `standard_price` as today

## No migration needed

`membership_tier` column already exists on the `members` table.
