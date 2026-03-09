# Pub EPOS System — Design Document
_Date: 2026-03-09_

## Overview

A full-featured Electronic Point of Sale system for a hybrid pub/members club. Supports walk-in customers and members with preferential pricing, stock management, member profiles, card/NFC membership identification, and cloud sync with offline fallback across multiple tills and mobile devices.

---

## Requirements Summary

| Requirement | Decision |
|---|---|
| Till setup | Multiple fixed tills + mobile devices (phones/tablets) |
| Customer types | Walk-in (standard price) + Members/Staff (member price) |
| Payments | Cash, card, and member tab |
| Stock management | Full — supplier tracking, purchase orders, wastage/spillage, cost vs sell margins |
| Member profiles | Name, membership number, contact, tier, tab balance, spend history, favourite drinks, renewal date |
| Member ID | USB barcode/QR scanner on fixed tills + Web NFC tap on mobile; QR camera fallback for iOS |
| Reporting | Daily sales, top products, busiest hours, stock valuation, CSV export |
| Staff permissions | None — all staff get full access |
| Data storage | Cloud (Supabase) with offline fallback (IndexedDB) |
| Priority | Till + Stock + Members all together at MVP level |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React PWA (Vite)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │   Till   │ │  Stock   │ │     Members      │ │
│  │ (POS UI) │ │  Mgmt    │ │    Profiles      │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │         Reports & Dashboard                  │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │   Offline Cache (IndexedDB via Dexie.js)     │ │
│  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
              │  sync when online
              ▼
┌─────────────────────────────────────────────────┐
│                  Supabase                        │
│  Postgres DB │ Auth │ Realtime │ Storage         │
└─────────────────────────────────────────────────┘
```

- **PWA** — installs on tablets and phones, works offline
- **Dexie.js** — wraps IndexedDB for offline storage; queued transactions sync to Supabase on reconnect
- **Supabase Realtime** — multiple tills see stock and tab changes live
- **React Router v6** — separate routes for Till, Stock, Members, Reports
- **Tailwind CSS** — responsive, works on 10" tablets down to phones

---

## Data Model

```sql
members
  id, name, membership_number, phone, email,
  membership_tier (member | staff),
  tab_balance, renewal_date,
  favourite_drinks[], notes, created_at

products
  id, name, category (draught|bottle|spirit|soft|food|other),
  sku, standard_price, member_price,
  stock_quantity, par_level, unit (pint|measure|bottle|each),
  supplier_id, cost_price, active

suppliers
  id, name, contact_name, phone, email, notes

stock_movements
  id, product_id, type (sale|restock|wastage|spillage|adjustment),
  quantity, notes, created_at, till_id

orders
  id, member_id (nullable — null = walk-in), till_id,
  payment_method (cash|card|tab), total_amount,
  status (open|paid|voided), created_at

order_items
  id, order_id, product_id, quantity,
  unit_price, member_price_applied (bool)

tabs
  id, member_id, balance, last_activity, created_at

purchase_orders
  id, supplier_id, status (draft|sent|received),
  total_cost, notes, created_at, received_at

purchase_order_items
  id, purchase_order_id, product_id,
  quantity_ordered, quantity_received, unit_cost
```

**Offline (IndexedDB mirrors):** products, members, pending_orders, pending_stock_movements

---

## Membership Tiers & Pricing

| Tier | Price applied |
|---|---|
| Walk-in | Standard price |
| Member | Member price |
| Staff | Member price (same as member) |

- Member identified by barcode scan, NFC tap, or name/number search
- Till auto-applies correct pricing when member is loaded
- Staff can override to standard price if needed

---

## Tabs

- Each member has an open-ended tab (no credit limit)
- "Add to Tab" payment option on till when a member is loaded
- Tab balance shown on member profile and till screen
- Members settle by cash or card at any time
- End-of-night report shows all open tabs and total outstanding

---

## Member Card Identification

- **Fixed tills** — USB HID barcode/QR scanner (acts as keyboard input, no driver needed)
- **Mobile devices** — Web NFC API (Android/Chrome); camera QR scan fallback for iOS
- Member cards encode membership number as both QR code and NFC
- On scan/tap: membership number looked up in local cache, member profile loads instantly

---

## UI Screens

### Navigation
- Tablet/desktop: left sidebar
- Mobile: bottom tab bar
- Tabs: Till | Stock | Members | Reports

### Till (POS)
- Product grid filterable by category
- Running order panel (right on tablet, bottom sheet on mobile)
- Member lookup / card scan / NFC tap to load member
- Payment buttons: Cash / Card / Add to Tab
- Void button
- Offline: queues sales, syncs on reconnect

### Stock
- Product list with RAG stock levels (red = below par, amber = low, green = ok)
- Log wastage / spillage
- Receive stock against purchase orders
- Add/edit products and par levels
- Supplier management
- Purchase order creation and tracking

### Members
- Searchable member list
- Member profile: details, tier, tab balance, spend history, favourite drinks
- Settle tab (cash or card)
- Add / edit member
- Renewal date alerts

### Reports
- Daily summary: total sales, cash vs card vs tab breakdown, voids
- Top selling products
- Busiest hours (bar chart)
- Stock valuation snapshot
- CSV export

---

## Offline & Sync Strategy

### Works offline
- Full till — cash sales, tab additions
- Member lookup (cached)
- Stock reads (last known state)
- Wastage/spillage logging

### Requires internet
- Card payments (terminal needs connectivity)
- Real-time cross-till stock sync
- Tab settlements
- Live reports

### Sync behaviour
- Offline actions queued in IndexedDB with timestamp + till ID
- On reconnect: queue flushes to Supabase in chronological order
- Stock conflicts (oversell offline) → stock goes negative, flagged for manual review
- Status bar always visible: `Online` | `Offline — N transactions pending`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| Routing | React Router v6 |
| State | Zustand |
| Offline cache | Dexie.js (IndexedDB) |
| Backend/DB | Supabase (Postgres + Auth + Realtime) |
| Barcode scanning | USB HID (keyboard input) |
| NFC | Web NFC API |
| QR fallback | html5-qrcode |
| PWA | vite-plugin-pwa |
| Reports export | papaparse |
| Charts | Recharts |
| Hosting | Vercel or Netlify (free tier) |
