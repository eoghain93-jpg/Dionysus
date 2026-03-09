# Club EPOS — Roadmap

## Overview

3 phases | 27 requirements | All v1 requirements covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|-----------------|
| 1 | Till UI | Staff can process sales end-to-end | TILL-01 to TILL-12 | 4 |
| 2 | Stock & Members UI | Staff can manage stock and member profiles | STOCK-01 to STOCK-05, MEM-01 to MEM-07 | 4 |
| 3 | Reports, Seed & Build | Staff can view reports, system has data, build ships | REP-01 to REP-05, SEED-01, SEED-02, BUILD-01, BUILD-02 | 4 |

## Phase 1: Till UI

**Goal:** Staff can process a complete sale — browse products, add to order, identify member, pay by cash/card/tab — both online and offline.

**Requirements:** TILL-01 to TILL-12

**Success Criteria:**
1. Staff can add 3 products and see correct totals in the order panel
2. Member lookup via typed search applies member pricing to all items
3. Barcode scanner input (fast keystrokes + Enter) loads a member profile
4. Cash, card, and tab payment buttons complete an order and clear the till
5. An order placed while offline appears in pendingOrders (IndexedDB) and syncs when reconnected

**Plans:**
- Plan A: Product grid + category filter + order panel (Tasks 10, 11)
- Plan B: Member lookup + barcode/NFC (Task 12)

## Phase 2: Stock & Members UI

**Goal:** Staff can view and manage stock levels, log movements, and manage member profiles including tab settlement.

**Requirements:** STOCK-01 to STOCK-05, MEM-01 to MEM-07

**Success Criteria:**
1. Stock list shows all products with RAG colour AND icon indicator (never colour alone)
2. Wastage/spillage modal saves a stock movement and updates stock quantity
3. Members list shows search, tab balances, and renewal alerts (icon + text)
4. Member profile shows spend history and tab settlement works (cash or card)
5. Add/edit member saves to Supabase and updates local cache

**Plans:**
- Plan A: Stock management page (Task 13)
- Plan B: Members page (Task 14)

## Phase 3: Reports, Seed & Build

**Goal:** Staff can view sales analytics, system has realistic seed data, and production build ships cleanly.

**Requirements:** REP-01 to REP-05, SEED-01, SEED-02, BUILD-01, BUILD-02

**Success Criteria:**
1. Daily summary shows correct totals for a selected date
2. Busiest hours bar chart renders with Recharts, value labels on hover
3. Top products list shows 7-day revenue ranked correctly
4. CSV export downloads a valid file
5. `npm run build` completes with zero errors, all tests pass

**Plans:**
- Plan A: Reports page (Task 15)
- Plan B: Seed data + production build (Tasks 16, 17)
