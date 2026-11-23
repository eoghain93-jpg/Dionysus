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
| **Every data change** | a sale and its lines, a void, a price or product edit, a tab payment or adjustment, a tab being blocked or unblocked, wastage and staff drinks, a member edit, someone made staff, a promotion switched on, Close Day | the database itself, whatever made the change (till, phone app, Stripe, the dashboard, hand-written SQL) |
| **Sign-ins and PINs** | who signed in on which till and when, sign-outs, wrong PINs, lockouts, PIN re-checks and what they were for, a PIN being set or changed | the database |
| **Refused attempts** | a till trying to delete or edit a past sale, stock movement, tab adjustment or correction directly | the database |
| **Till actions** | line removed from an order, order voided before payment, an order parked and brought back, a tab sale refused because the tab is blocked, members-only pricing switched on, drawer opened with no sale, printer address changed, report viewed / exported / emailed, till went offline, queued sales sent later, till locked / unlocked | the till app (shown as "reported by the till") |
| **The log's own health** | nightly integrity check, a till seen from a new network address, anything not being recorded, the log being viewed | the database |

For each sale line the log also freezes the product's **list prices at that
moment** next to the price charged, so "was this sold at the wrong price?" has
an answer even after the product is edited again.

Never recorded: PINs, PIN hashes, passwords, session tokens.

## How sure the log is about "who"

Every entry carries one of these next to the staff name:

- **PIN checked** — the database itself checked that person's PIN on that
  till, and the request carried the session it issued.
- **matched a sign-in** — a sale that arrived late (rung offline), or a till
  action reported later, names a person who the database knows was signed in
  on that till at that time.
- **said to be** — the till named someone, but the database could not
  confirm it (an old version of the till app, the fallback PIN check, or
  work done after "Carry on without checking the PIN").
- **nobody signed in**.

A sale is filed under **who rang it**. If it was sent to the server later
(an offline sale) while someone else was signed in, the entry says so. A
live sale that names someone other than the signed-in person is an alert.

The **till** always comes from the device's own login, never from what the
app claims.

## Signing in and locking

- Every page now needs a staff member signed in, not just the Till page.
- The till locks itself after 5 minutes without a touch. The open order is
  kept; a PIN carries on, or someone else signs in. Change the time (or set 0
  for never) in **Settings**. That change is itself recorded.
- Locking ends that person's sign-in on the server; unlocking is a fresh,
  PIN-checked sign-in. Nothing done at a locked till is credited to them.
- It does not lock while the till cannot reach the server (offline, or the
  internet is down), because a PIN cannot be checked then.
- **A till is never left unusable.** If the PIN cannot be checked (server
  unreachable), or that person's PIN is locked out after five wrong tries,
  the lock screen offers "Carry on without checking the PIN" for the same
  person. Using it is recorded as an alert (serious, for the locked-out
  case), and what is done afterwards is recorded as "said to be", not
  "PIN checked", until someone signs in properly. So the lock cannot stop
  trade — but getting past it without a PIN is always visible in the Log.
  One wrinkle: if the till was cut off from the server when it locked, the
  server only hears about the lock once the connection is back, so sales
  rung offline after that lock can still show as "matched a sign-in" for
  that person. The carry-on alert carries its own time; sales after it are
  the ones to read as "said to be".
- "Sign out" is refused while the server cannot be reached (use Lock): a
  signed-out till needs the server to sign anyone back in. If the server
  does not answer within a few seconds the sign-out is called off, the till
  says so, and the person stays signed in.
- **Parked orders** (the Park button) live only in that till's memory until
  they are brought back and paid. The Log records what was parked and when
  it was brought back; a parked order with no "brought back" after it is
  worth asking about.

## What a till can no longer do

A till (or anyone holding a till's login) can no longer delete or rewrite
past sales, sale lines, stock movements, tab adjustments, payment corrections,
cash-back, prize payouts, guest sign-ins, the price change log, members,
products or day closes by talking to the database directly. The attempt is
refused and recorded as serious. Everything the app itself does is unaffected.

A till also cannot write a member's **PIN, tab balance, login link or
settlement date** straight into their record (only the app's own functions
can): the attempt is put back and recorded as serious. Without this, someone
could give a colleague a PIN of their choosing and sign in as them.

Editing a past sale's amount directly is **recorded as serious but not yet
refused**; it can be switched to refused once a week or two of entries show
nothing legitimate depends on it. A sale or a sale line written straight into
the table rather than by the app is recorded as an alert.

"Directly" includes Supabase's GraphQL door, which the app does not use. If
you do not need it, switching it off in the Supabase dashboard is one less
way in.

Repairs by hand (dashboard, SQL) still work, and are always recorded as
"outside the till" alerts with the full before and after.

## Tamper evidence

- The log lives where the till, the phone app and even the service key cannot
  read or write it.
- Its rows cannot be updated or deleted by anyone without first switching the
  protection off — and a nightly check reports if that has happened.
- Every five minutes the new entries are sealed together with the previous
  seal. Changing, removing or adding any sealed entry breaks every seal after
  it. **Log → Check now** re-checks the chain on demand (on a large log: every
  seal, plus every entry from the last 30 days); the whole log is re-checked
  every night.
- Copies of the newest seal are kept **outside the database**: each till
  remembers the last one it saw (if the database later no longer has it, the
  till keeps its copy as evidence, the Log shows it, and an alert is raised),
  and Close Day puts the seal's short code in the Z-report
  email subject. To prove the log has not been rewritten, compare the code in
  an old email with the one the Log shows for that seal.

## What it cannot do

- Someone with the database password or dashboard access can switch the
  protection off and rewrite the log. That is *detectable* (seal codes in
  emails, the tills' own copies, the nightly check — which also compares the
  audit code itself against a stored fingerprint) but not *preventable*.
- **Staff PINs are four digits, and a till can read their scrambled form.**
  Someone with technical skill and time at a till could work out a
  colleague's PIN from it and sign in as them. So "PIN checked" means the
  right PIN was entered, not proof of who entered it. Closing this needs the
  PIN check moved fully into the database and the old sign-in function
  redeployed — a follow-up, once every till runs this version. (This version
  no longer asks the server for them, and clears copies kept by older
  versions when the till starts; the database itself still lets a till
  device read them until that follow-up.)
- The lock is a record, not a wall: see "Signing in and locking".
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
select auditlog.verify();     -- ok / problems (the whole log)
select auditlog.coverage();   -- anything missing, switched off or redirected
select * from auditlog.failures order by id desc limit 20;  -- should be empty
```

A new table is not recorded until `select auditlog.attach_all();` has been
run (put it at the end of the migration that creates the table; it only
touches tables that are not yet covered, so it takes no locks on the busy
ones). The nightly check raises an alert for any table that is not covered.

A migration that changes the audit layer's own functions or triggers must end
with `select auditlog.accept_manifest('<why>');` — otherwise the nightly check
reports that the audit code no longer matches the accepted version (which is
exactly what it should report if someone changes it quietly). A database
engine upgrade can also trip it once; accept it the same way.

Erasure request for a member (keeps the seals valid, records that it was done):

```sql
select auditlog.erase_member_data('<member id>', 'erasure request, <date>');
```

Size: about 2 KB per sale, roughly 80 MB a year at current trade. The Log's
health strip shows the current size.

## Known gaps (follow-ups)

None of these stops a sale or loses a record; they are about how precisely
unusual situations are labelled.

- **PIN hashes and the old sign-in function.** A till device can still read
  staff PIN hashes from the database, and the `verify-pin` edge function
  still lets anyone holding the app's public key trigger a 15-minute PIN
  lockout. Both need the edge functions redeploying (they are not deployed
  automatically) and the hash column closing off once every till runs this
  version.
- **Sign-out time after an offline lock.** See "Signing in and locking": the
  server stamps a sign-out when it hears of it, not when the till locked.
- **A superseded PIN attempt.** If two PIN attempts are in flight at the lock
  screen and the earlier answer arrives last, the till can end up holding
  the earlier sign-in. Same person, so nothing is misattributed; a spare
  sign-in is left open until it expires.
- **A till showing someone signed in with no session.** After a second
  browser tab signs in, or the 24-hour session expiry with auto-lock set to
  "never", actions are recorded as "said to be" until the next lock or
  sign-in. The till does not yet notice this by itself.
- **Supabase's GraphQL door** is not used by the app and is refused by the
  guards; switching it off in the Supabase dashboard removes it altogether.
- **The audit trigger on a tab adjustment made by an old app version** is an
  alert with no staff name until every till runs this version.
