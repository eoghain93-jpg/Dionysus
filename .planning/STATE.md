# Club EPOS — State

## Current Phase

Phase 2: Stock & Members UI

## Status

In Progress

## Completed Phases

- ✓ Phase 0: Foundation (pre-GSD, Tasks 0–9)
- ✓ Phase 1: Till UI (Tasks 10–12 + gap fixes)

## Foundation (pre-GSD, all complete)

- ✓ Design system (OLED dark, fonts, Lucide icons)
- ✓ All dependencies installed
- ✓ Tailwind + PWA + Vitest configured
- ✓ Supabase schema deployed
- ✓ Supabase client + Dexie offline DB
- ✓ App shell (routing, nav, layout, StatusBar)
- ✓ Zustand stores (till, sync)
- ✓ Product data layer
- ✓ Member data layer
- 17 tests passing

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

## Next Action

Execute Phase 2: Stock & Members UI
- Plan A: Stock management page (StockList, StockMovementModal, ProductFormModal)
- Plan B: Members page (MemberList, MemberProfile, MemberFormModal, SettleTabModal)
