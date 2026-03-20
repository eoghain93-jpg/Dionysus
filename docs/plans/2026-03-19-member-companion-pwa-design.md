# Member Companion PWA — Design Document

**Date:** 2026-03-19
**Status:** Approved

## Overview

A Progressive Web App (PWA) companion for club members. Members can view their digital membership card, check their tab balance, top up via Stripe, and browse their transaction history. Built as a second Vite app in the existing monorepo, sharing the same Supabase project.

---

## Architecture

### Repo Structure

```
club-epos/
├── src/                  ← existing EPOS (staff-facing)
├── member-app/
│   └── src/              ← new member PWA
├── supabase/
│   └── functions/        ← Supabase Edge Functions (payments, invites)
└── package.json
```

### Deployments

Two separate deployments from the same repo:
- `epos.yourclub.com` — existing EPOS (staff)
- `app.yourclub.com` — member PWA

### Authentication

Supabase Auth with magic link invites. When staff create a member (with an email address) in the EPOS, a Supabase Auth invite email is automatically sent. The member clicks the link, is authenticated, and lands on the PWA. No passwords required.

### Payments

Stripe via Supabase Edge Functions:
1. Member initiates top-up → Edge Function `create-checkout-session` creates a Stripe Checkout session
2. Member completes payment on Stripe's hosted page
3. Stripe webhook → Edge Function `stripe-webhook` → increments tab balance + inserts transaction record

### Security

Supabase Row Level Security (RLS) ensures members can only access their own data. All writes (tab balance updates, transaction inserts) go through Edge Functions using the Supabase service role — members have no direct write access.

---

## Screens

Bottom navigation bar with four tabs:

### 1. My Card
- Member's name, membership number, and QR code (encoding membership number)
- Shown at the till to be scanned
- Works offline once loaded

### 2. My Tab
- Current tab balance displayed prominently
- "Top Up" button → preset amounts (£5, £10, £20, £50) + custom input
- Triggers Stripe Checkout flow
- Balance refreshes on return from payment

### 3. History
- Scrollable transaction list
- Each entry: date, description, amount (in/out)
- Covers both till purchases and top-ups

### 4. Account
- Member name, email, membership number
- Log out button
- Read-only — staff manage all member data via EPOS

---

## Onboarding Flow

1. Staff create member in EPOS (name + email — as today)
2. Supabase automatically sends magic link invite email
3. Member taps link → authenticated → lands on My Card screen
4. Browser prompts member to add PWA to home screen

---

## Data Design

### Changes to `members` table

| Column | Type | Notes |
|---|---|---|
| `email` | text | For Supabase Auth invite (add if not present) |
| `auth_user_id` | uuid | Links Supabase Auth user → member record |

### New `transactions` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `member_id` | uuid | FK → members.id |
| `amount` | numeric | Positive = top-up, negative = purchase |
| `description` | text | e.g. "Bar tab purchase", "Top up" |
| `created_at` | timestamptz | |
| `stripe_payment_id` | text | Nullable — only set on top-ups |

### RLS Policies

- `members`: SELECT where `auth_user_id = auth.uid()`
- `transactions`: SELECT where `member_id` matches authenticated member
- No direct INSERT/UPDATE/DELETE for members — all writes via Edge Functions (service role)

---

## Edge Functions

| Function | Trigger | Purpose |
|---|---|---|
| `create-checkout-session` | Member taps Top Up | Creates Stripe Checkout session, returns URL |
| `stripe-webhook` | Stripe POST | Validates event, increments tab balance, inserts transaction |
| `invite-member` | Staff creates member | Sends Supabase Auth magic link invite email |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite (same as EPOS) |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (magic link) |
| Payments | Stripe Checkout |
| Serverless | Supabase Edge Functions (Deno) |
| PWA | vite-plugin-pwa |
| Deployment | Vercel (separate deployment from same repo) |
