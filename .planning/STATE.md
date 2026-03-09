# Club EPOS — State

## Current Phase

Phase 3: Reports, Seed & Build

## Status

In Progress

## Completed Phases

- ✓ Phase 0: Foundation (pre-GSD, Tasks 0–9)
- ✓ Phase 1: Till UI (Tasks 10–12 + gap fixes)
- ✓ Phase 2: Stock & Members UI (Tasks 13–14)

## Phase 1 Completion (TILL-01 to TILL-12 — all ✓)

- ✓ TILL-01/02: Product grid with category filter, tap to add
- ✓ TILL-03: Quantity +/- and remove in OrderPanel (44px touch targets)
- ✓ TILL-04: Member typed search in MemberLookup
- ✓ TILL-05: USB HID barcode scanner (global keydown buffer)
- ✓ TILL-06: Web NFC (NDEFReader) + camera QR fallback via html5-qrcode
- ✓ TILL-07: Member pricing auto-applied via tillStore
- ✓ TILL-08/09/10: Cash / Card / Tab payment in OrderPanel
- ✓ TILL-11: Void order
- ✓ TILL-12: Offline queue via Dexie, syncs on reconnect

## Phase 2 Completion (STOCK-01..05 + MEM-01..07 — all ✓)

- ✓ STOCK-01: Stock list with RAG badge (colour + icon + text)
- ✓ STOCK-02: Wastage/spillage modal → logStockMovement
- ✓ STOCK-03: Restock modal → logStockMovement
- ✓ STOCK-04: Add product form (all fields)
- ✓ STOCK-05: Edit product form (pre-populated)
- ✓ MEM-01: Searchable member list
- ✓ MEM-02: Tab balance shown when > 0
- ✓ MEM-03: Renewal alert (Clock icon + "Renewal due" text) within 30 days
- ✓ MEM-04: Full member profile (details, tier, spend history, favourite drinks)
- ✓ MEM-05: Settle tab by cash or card
- ✓ MEM-06: Add new member form
- ✓ MEM-07: Edit member form (pre-populated)
- 42 tests passing

## Next Action

Execute Phase 3: Reports, Seed & Build
- Plan A: Reports page (DailySummary, BusiestHours chart, TopProducts, CSV export)
- Plan B: Seed data + PWA icons + production build
