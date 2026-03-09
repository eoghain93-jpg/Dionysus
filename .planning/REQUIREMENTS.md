# Club EPOS — Requirements

## v1 Requirements

### Till (POS)

- [ ] **TILL-01**: Staff can browse products in a grid, filtered by category (draught, bottle, spirit, soft, food, other)
- [ ] **TILL-02**: Staff can add products to a running order by tapping/clicking
- [ ] **TILL-03**: Staff can adjust quantity or remove items from the order
- [ ] **TILL-04**: Staff can look up a member by membership number (typed search)
- [ ] **TILL-05**: Member can be identified by scanning a barcode/QR card (USB HID scanner)
- [ ] **TILL-06**: Member can be identified by NFC tap (Android/Chrome) or camera QR (iOS fallback)
- [ ] **TILL-07**: When a member is active, all prices switch to member pricing automatically
- [ ] **TILL-08**: Staff can process payment by cash
- [ ] **TILL-09**: Staff can process payment by card
- [ ] **TILL-10**: Staff can add order to a member's tab (requires active member)
- [ ] **TILL-11**: Staff can void the current order
- [ ] **TILL-12**: Till works fully offline — queues orders to sync when reconnected

### Stock

- [ ] **STOCK-01**: Staff can view all products with current stock levels colour-coded (red/amber/green) and icon-paired
- [ ] **STOCK-02**: Staff can log wastage or spillage for any product
- [ ] **STOCK-03**: Staff can log a restock (increases stock quantity)
- [ ] **STOCK-04**: Staff can add a new product with all fields (name, category, prices, par level, supplier, unit)
- [ ] **STOCK-05**: Staff can edit an existing product

### Members

- [ ] **MEM-01**: Staff can view a searchable list of all active members
- [ ] **MEM-02**: Members with tab balance show balance in list
- [ ] **MEM-03**: Members with renewal due within 30 days show an alert indicator (icon + text, not colour alone)
- [ ] **MEM-04**: Staff can view a member's full profile (details, tier, tab balance, spend history, favourite drinks)
- [ ] **MEM-05**: Staff can settle a member's tab by cash or card
- [ ] **MEM-06**: Staff can add a new member (name, phone, email, tier, renewal date)
- [ ] **MEM-07**: Staff can edit an existing member's details

### Reports

- [ ] **REP-01**: Staff can view a daily sales summary (total, transaction count, voids, cash/card/tab breakdown)
- [ ] **REP-02**: Staff can select any date for the daily summary
- [ ] **REP-03**: Staff can view busiest hours bar chart (last 7 days)
- [ ] **REP-04**: Staff can view top 10 selling products by revenue (last 7 days)
- [ ] **REP-05**: Staff can export daily orders to CSV

### Seed & Verification

- [ ] **SEED-01**: System has sample products covering all categories
- [ ] **SEED-02**: System has sample members (member + staff tiers)
- [ ] **BUILD-01**: Production build completes without errors
- [ ] **BUILD-02**: All tests pass

## v2 Requirements (deferred)

- Supplier purchase order management UI
- SMS/email tab reminders
- Premium member tier
- Staff permissions and roles
- Shift management / clock in-out
- Kitchen display screen integration

## Out of Scope

- Staff login/auth — no authentication system
- Tab credit limits — open-ended by design
- Multi-location support — single venue

## Traceability

| Requirement | Phase |
|-------------|-------|
| TILL-01 to TILL-12 | Phase 1: Till UI |
| STOCK-01 to STOCK-05 | Phase 2: Stock & Members UI |
| MEM-01 to MEM-07 | Phase 2: Stock & Members UI |
| REP-01 to REP-05 | Phase 3: Reports, Seed & Build |
| SEED-01, SEED-02, BUILD-01, BUILD-02 | Phase 3: Reports, Seed & Build |
