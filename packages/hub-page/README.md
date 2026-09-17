# Akiba Hub

The Akiba Hub app at [hub.akibamiles.com](https://hub.akibamiles.com) — where members earn AkibaMiles, manage their Akiba Pass, discover participating merchants, and redeem Miles for vouchers.

> **Important:** Akiba Pass does not sell products, collect consumer payments, or create orders. Members pay merchants directly.

## What it does

**Public (no login):**

- Landing page with featured merchants, rewards overview, and how-it-works
- `/merchants` — discover verified merchants, branches, offers, and available vouchers
- `/vouchers` — browse discounts and offers available for Miles
- `/rewards` — active campaigns (MiniPay, Base, Celo, etc.)
- `/quests` — partner quests fetched from Akiba-Platform

**Authenticated (`/me`, via Supabase auth):**

- Akiba Pass — stable pass ID + QR for in-store Scan & Award
- Miles balance — on-chain ERC-20 balance (Celo) + Platform ledger balance (unclaimed in-store Miles)
- Linked wallets (MiniPay ecosystem), wallet picker for multi-wallet emails
- Activity feed — merchant scan awards + engagement earnings
- Voucher wallet and presentation for in-store use

**Miles & voucher flow:**

- Members pay participating merchants directly and show their Akiba Pass to collect eligible Miles
- Members spend Miles to acquire vouchers, then present the voucher QR or code to the merchant
- Cart, checkout, payment initiation, delivery, product ordering, and order history are intentionally unavailable
- M-Pesa callback/status handlers remain only to reconcile payments that were already pending at retirement; initiation always returns `410 Gone`

## Running locally

```bash
# From the monorepo root
pnpm --filter @akibamiles/hub-page dev

# Or from this directory
pnpm dev
```

Dev server prefers port **3003** → [http://localhost:3003](http://localhost:3003).

Copy `.env.local.example` to `.env.local` and fill in Supabase, Platform (`AKIBA_API_URL` / `AKIBA_API_KEY`), and chain (`MINIPOINTS_ADDRESS`, `CELO_RPC_URL`) values. M-Pesa values are only needed while reconciling pre-retirement pending payments.

Merchant-directory synchronization also requires
`DIRECTORY_REVALIDATION_SECRET`, shared only with dashboard-merchant. Its
outbox worker calls `POST /api/internal/revalidate-merchant-directory`; the
endpoint is authenticated even while directory pages remain force-dynamic.
Deploy Akiba-Platform migration 071 before this Hub version because directory
cursors use the composite distance/name/ID contract introduced there.

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
| `src/app/merchants/` | Merchant discovery, branches, and offers |
| `src/app/vouchers/` | Voucher discovery and presentation |
| `src/app/api/payments/mpesa/` | Retired initiation boundary plus pending-payment reconciliation |
| `src/app/api/shop/vouchers/` | Voucher quote, acquisition, and presentation APIs |
| `src/app/api/vouchers/` | Programs, grants, raffles, clawback |
| `src/lib/akiba/` | Platform adapters (purchase events, activity, ledger) |
| `src/lib/vouchers/` | Miles-funded voucher issuance and programs |
| `src/lib/mpesa.ts` | Read-only Daraja status reconciliation |
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
- **Rewards:** AkibaMiles balances and merchant vouchers
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
