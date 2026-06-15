# Akiba Hub Page

Public discovery landing page for [hub.akibamiles.com](https://hub.akibamiles.com).

## Purpose

This is the **public** Akiba Hub discovery page. It lets anyone:

- Browse live and upcoming AkibaMiles campaigns, raffles, games, and partner quests
- Understand how the personalized Akiba Hub app works
- Discover reward categories (MiniPay, Base, Games, Vouchers, etc.)
- Learn about connecting wallets for personalized rewards
- Explore partnership opportunities

**This page contains no personalization, eligibility checks, or login.** Those features live inside the Akiba Hub app.

## Running locally

```bash
# From the monorepo root
pnpm --filter @akibamiles/hub-page dev

# Or from this directory
pnpm dev
```

The dev server starts on **port 3003** at [http://localhost:3003](http://localhost:3003).

## Building

```bash
pnpm --filter @akibamiles/hub-page build
pnpm --filter @akibamiles/hub-page start
```

## Key files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main page — assembles all sections |
| `src/app/layout.tsx` | Root layout with SEO metadata and fonts |
| `src/data/campaigns.ts` | Campaign card data (update to add/edit campaigns) |
| `src/data/categories.ts` | Category grid data |
| `src/constants/links.ts` | CTA URLs — update with real URLs when ready |
| `src/components/` | All page section components |

## Updating campaign data

Edit `src/data/campaigns.ts` to add, remove, or update campaign cards. Each campaign has:

- `status`: `"live"` | `"starting-soon"` | `"upcoming"`
- `category`: one of the defined category types
- `cta` / `ctaHref`: button label and destination URL

## Updating links

All CTA URLs are centralized in `src/constants/links.ts`. Update these when real URLs are confirmed:

- `AKIBA_HUB_APP_URL` — the main app URL
- `PARTNER_WITH_AKIBA_URL` — partner onboarding URL

## Tech stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS with Akiba brand tokens
- **Fonts:** Sterling (local, from `/public/fonts/sterling/`) + DM Sans (Google Fonts)
- **Icons:** Lucide React
- **Language:** TypeScript

## Design tokens

The page uses the Akiba brand palette defined in `tailwind.config.ts`:

| Token | Value | Usage |
|-------|-------|-------|
| `akiba-teal` | `#238D9D` | Primary brand, CTAs, accents |
| `akiba-ink` | `#0D0E0C` | Headings, body text |
| `akiba-muted` | `#504C4C` | Secondary text |
| `akiba-paper` | `#FCFCFC` | Page background |
| `akiba-card` | `#F7F7F7` | Card backgrounds |
| `akiba-line` | `#E2E2E2` | Borders |
| `akiba-tint` | `#EAF7F9` | Teal tint backgrounds |
