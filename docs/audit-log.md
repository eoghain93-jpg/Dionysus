# The audit log

Everything that changes in the till's data, every staff sign-in and PIN
attempt, and the sensitive things staff do at the till that change no data
(taking a line off an order, opening the drawer without a sale, exporting a
report) is recorded: **what, when, which till, which staff member, from which
network address**. The record cannot be edited or deleted from a till, and it
is sealed so that tampering by anyone else can be detected.

You read it in the till app: **Log** in the menu.

## What is recorded

| | Examples | Recorded by |
|---|---|---|
| **Every data change** | a sale and its lines, a void, a price or product edit, a tab payment or adjustment, wastage and staff drinks, a member edit, someone made staff, a promotion switched on, Close Day | the database itself, whatever made the change (till, phone app, Stripe, the dashboard, hand-written SQL) |
| **Sign-ins and PINs** | who signed in on which till and when, sign-outs, wrong PINs, lockouts, PIN re-checks and what they were for, a PIN being set or changed | the database |
| **Refused attempts** | a till trying to delete or edit a past sale, stock movement, tab adjustment or correction directly | the database |
| **Till actions** | line removed from an order, order voided before payment, members-only pricing switched on, drawer opened with no sale, printer address changed, report viewed / exported / emailed, till went offline, queued sales sent later, till locked / unlocked | the till app (shown as "reported by the till") |
| **The log's own health** | nightly integrity check, a till seen from a new network address, anything not being recorded, the log being viewed | the database |

For each sale line the log also freezes the product's **list prices at that
moment** next to the price charged, so "was this sold at the wrong price?" has
an answer even after the product is edited again.

Never recorded: PINs, PIN hashes, passwords, session tokens.

## How sure the log is about "who"

Every entry carries one of these next to the staff name:

- **PIN checked** — the database itself checked that person's PIN on that
  till, and the request carried the session it issued.
- **matched a sign-in** — a sale that arrived late (rung offline) names a
  person who the database knows was signed in on that till at that time.
- **said to be** — the till named someone, but the database could not
  confirm it (an old version of the till app, or the fallback PIN check).
- **nobody signed in**.

The **till** always comes from the device's own login, never from what the
app claims.

## Signing in and locking

- Every page now needs a staff member signed in, not just the Till page.
- The till locks itself after 5 minutes without a touch. The open order is
  kept; a PIN carries on. Change the time (or set 0 for never) in
  **Settings**. That change is itself recorded.
- It never locks while the till is offline, because a PIN cannot be checked
  offline.

## What a till can no longer do

A till (or anyone holding a till's login) can no longer delete or rewrite
past sales, sale lines, stock movements, tab adjustments, payment corrections,
cash-back, prize payouts, guest sign-ins, the price change log, members,
products or day closes by talking to the database directly. The attempt is
refused and recorded as serious. Everything the app itself does is unaffected.

Editing a past sale's amount or a tab balance directly is **recorded as
serious but not yet refused**; it can be switched to refused once a week or
two of entries show nothing legitimate depends on it.

Repairs by hand (dashboard, SQL) still work, and are always recorded as
"outside the till" alerts with the full before and after.

## Tamper evidence

- The log lives where the till, the phone app and even the service key cannot
  read or write it.
- Its rows cannot be updated or deleted by anyone without first switching the
  protection off — and a nightly check reports if that has happened.
- Every five minutes the new entries are sealed together with the previous
  seal. Changing, removing or adding any sealed entry breaks every seal after
  it. **Log → Check now** re-checks the whole chain on demand; it also runs
  every night.
- Copies of the newest seal are kept **outside the database**: each till
  remembers the last one it saw (and raises an alert if the database no
  longer has it), and Close Day puts the seal's short code in the Z-report
  email subject. To prove the log has not been rewritten, compare the code in
  an old email with the one the Log shows for that seal.

## What it cannot do

- Someone with the database password or dashboard access can switch the
  protection off and rewrite the log. That is *detectable* (seal codes in
  emails, the tills' own copies, the nightly check) but not *preventable*.
- "Till actions" are the app's own account. Someone who modifies the app on
  the till could leave them out. Data changes are recorded by the database and
  cannot be skipped.
- Within the lock time, anyone at an unlocked till acts under the name of
  whoever entered a PIN last.
- Reading data is not recorded, only viewing reports and exports through the
  app.
- Nothing before the first entry ("Recording starts here") is covered.
- The cash drawer can be opened by other software on the till PC without the
  app knowing.

## For whoever maintains it

Database side: `supabase/migrations/20261123120000_audit_log.sql` (read its
header first). Tests: `supabase/tests/local-db.sh up && supabase/tests/local-db.sh test`.

Switches (run in the SQL editor; each change is itself recorded as serious):

```sql
-- Stop refusing direct ledger edits/deletes from tills (still recorded):
update auditlog.settings set guards_enforced = false;

-- Stop capturing row changes altogether (only if capture itself misbehaves):
update auditlog.settings set capture_enabled = false;
```

Check integrity and coverage by hand:

```sql
select auditlog.verify();     -- ok / problems
select auditlog.coverage();   -- tables not recorded, triggers switched off
select * from auditlog.failures order by id desc limit 20;  -- should be empty
```

A new table is not recorded until `select auditlog.attach_all();` has been
run (put it at the end of the migration that creates the table). The nightly
check raises an alert for any table that is not covered.

Erasure request for a member (keeps the seals valid, records that it was done):

```sql
select auditlog.erase_member_data('<member id>', 'erasure request, <date>');
```

Size: about 2 KB per sale, roughly 80 MB a year at current trade. The Log's
health strip shows the current size.
