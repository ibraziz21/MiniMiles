# Akiba Hub

The Akiba Hub app at [hub.akibamiles.com](https://hub.akibamiles.com) — where shoppers earn AkibaMiles, manage their Akiba Pass, shop from merchants, and redeem vouchers.

> **Note:** This package started as a static public discovery page and has since grown into the full Hub app with auth, payments, and voucher redemption.

## What it does

**Public (no login):**

- Landing page with featured merchants, rewards overview, and how-it-works
- `/shop` — browse verified merchants and products
- `/rewards` — active campaigns (MiniPay, Base, Celo, etc.)
- `/quests` — partner quests fetched from Akiba-Platform

**Authenticated (`/me`, via Supabase auth):**

- Akiba Pass — stable pass ID + QR for in-store Scan & Award
- Miles balance — on-chain ERC-20 balance (Celo) + Platform ledger balance (unclaimed in-store Miles)
- Linked wallets (MiniPay ecosystem), wallet picker for multi-wallet emails
- Activity feed — merchant scan awards + engagement earnings
- Orders and vouchers (`/my-vouchers`)

**Commerce & rewards flow:**

- Checkout with stablecoins or M-Pesa (Daraja STK push: `initiate` → `callback` → `status`)
- Verified purchases are forwarded to Akiba-Platform as purchase events (`src/lib/akiba/purchase-events.ts`); Platform decides Miles awards
- Voucher lifecycle: issue → claim (atomic DB RPC) → redeem, plus raffle, grant, and clawback admin routes

## Running locally

```bash
# From the monorepo root
pnpm --filter @akibamiles/hub-page dev

# Or from this directory
pnpm dev
```

Dev server prefers port **3003** → [http://localhost:3003](http://localhost:3003).

Copy `.env.local.example` to `.env.local` and fill in Supabase, Platform (`AKIBA_API_URL` / `AKIBA_API_KEY`), M-Pesa, and chain (`MINIPOINTS_ADDRESS`, `CELO_RPC_URL`) values.

## Testing

```bash
pnpm test               # unit tests (vitest)
pnpm test:integration   # integration tests (vitest.config.integration.ts)
```

## Key directories

| Path | Purpose |
|------|---------|
| `src/app/page.tsx` | Public landing page |
| `src/app/(protected)/me/` | Profile, Pass, wallets, activity |
| `src/app/shop/` | Merchant browsing, product pages, checkout |
| `src/app/api/payments/mpesa/` | M-Pesa STK push flow |
| `src/app/api/shop/` | Merchants, orders, voucher issue/redeem |
| `src/app/api/vouchers/` | Programs, grants, raffles, clawback |
| `src/lib/akiba/` | Platform adapters (purchase events, activity, ledger) |
| `src/lib/vouchers/` | Issuance, claim/redemption (atomic RPCs), programs |
| `src/lib/mpesa.ts` | Daraja client |
| `src/lib/pass-token.ts` | Signed pass tokens |
| `src/lib/supabase/` | Client/server/admin Supabase clients |

## Conventions

- **No PII in logs.** Do not `console.log` emails, user IDs, wallet addresses, or phone numbers. `console.error`/`warn` for operational failures only.
- Brand name is always **Akiba** (capital A); points are **AkibaMiles** / **Miles**.
- CTA URLs are centralized in `src/constants/links.ts`.

## Tech stack

- **Framework:** Next.js 14 (App Router)
- **Auth & DB:** Supabase (`@supabase/ssr`)
- **Chain:** viem, Celo Mainnet (Miles are an ERC-20)
- **Payments:** M-Pesa Daraja, stablecoins
- **Styling:** Tailwind CSS with Akiba brand tokens
- **Fonts:** Sterling (local) + DM Sans
- **Icons:** Lucide React
- **Tests:** Vitest

## Design tokens

| Token | Value | Usage |
|-------|-------|-------|
| `akiba-teal` | `#238D9D` | Primary brand, CTAs, accents |
| `akiba-ink` | `#0D0E0C` | Headings, body text |
| `akiba-muted` | `#504C4C` | Secondary text |
| `akiba-paper` | `#FCFCFC` | Page background |
| `akiba-card` | `#F7F7F7` | Card backgrounds |
| `akiba-line` | `#E2E2E2` | Borders |
| `akiba-tint` | `#EAF7F9` | Teal tint backgrounds |
