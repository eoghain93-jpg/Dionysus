# Club EPOS

## What We're Building

A full-featured pub/members club Electronic Point of Sale (EPOS) Progressive Web App. The system serves a hybrid venue — walk-in customers and registered members — across multiple fixed tills and mobile devices simultaneously.

## Core Value

Staff can process sales instantly (cash, card, or member tab), stock updates automatically, and member profiles persist spending history — replacing a non-electronic system with zero training friction.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React + Vite PWA | Installable on tablets/phones, existing scaffold | ✓ Done |
| Supabase (Postgres + Realtime) | Cloud DB + Auth + real-time sync, no server to manage | ✓ Done |
| Dexie.js (IndexedDB) | Offline cache — queued transactions sync on reconnect | ✓ Done |
| Tailwind CSS + OLED dark theme | OLED-optimised dark UI, hospitality feel | ✓ Done |
| Lucide React icons | SVG icons, no emojis, accessibility-first | ✓ Done |
| Karla + Playfair Display SC fonts | Clean body + elegant hospitality headings | ✓ Done |
| USB HID barcode + Web NFC | Member card ID on fixed tills and mobile | Pending |
| Zustand state management | Lightweight, no boilerplate | ✓ Done |

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS v4
- **State:** Zustand
- **Routing:** React Router v6
- **Offline:** Dexie.js (IndexedDB)
- **Backend:** Supabase (Postgres, Realtime, Auth)
- **Icons:** lucide-react
- **Charts:** Recharts
- **PWA:** vite-plugin-pwa + Workbox
- **Tests:** Vitest + React Testing Library

## Requirements

### Validated

- ✓ React + Vite project scaffolded
- ✓ All dependencies installed
- ✓ Tailwind CSS + PWA + Vitest configured
- ✓ Supabase schema deployed (products, members, orders, order_items, tabs, stock_movements, purchase_orders, suppliers)
- ✓ Supabase client + Dexie offline DB
- ✓ App shell with responsive navigation (sidebar + mobile bottom bar)
- ✓ Zustand stores (till state, sync state)
- ✓ Connectivity status bar + offline sync service
- ✓ Product data layer (online + offline)
- ✓ Member data layer (online + offline, membership number lookup)

### Active

- [ ] Till UI — product grid with category filter, order panel, payment (cash/card/tab), member lookup with barcode/NFC
- [ ] Stock UI — product list with RAG stock levels, wastage/spillage logging, add/edit products
- [ ] Members UI — member list, profiles, tab settlement, add/edit
- [ ] Reports UI — daily summary, busiest hours chart, top products, CSV export
- [ ] Seed data — sample products, members, suppliers
- [ ] PWA icons + production build verified

### Out of Scope

- Staff permissions/roles — all staff get full access
- Premium member tier — only Member and Staff tiers
- Tab credit limits — open-ended tabs
- SMS/email reminders — future feature
- Supplier purchase orders UI — future feature

## Constraints

- Node.js at: `C:/Users/Eoghain.McLaughlin/node/node-v24.14.0-win-x64/node-v24.14.0-win-x64`
- Work in worktree: `c:/Users/Eoghain.McLaughlin/club-epos/.worktrees/feature-epos-build`
- Supabase project: `https://sqpokcnoefhfmcvdttqu.supabase.co`
- 11 tests currently passing

---
*Last updated: 2026-03-09 after GSD initialization (brownfield, Tasks 0-9 complete)*
