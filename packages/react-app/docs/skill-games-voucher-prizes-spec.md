# Spec: Skill Games — Voucher Prizes (replacing USDT)

**Package:** `packages/react-app` (+ small backend/SQL touchpoints)
**Pilot merchant:** Leshan Electronics (Mombasa, Kenya)
**Status:** Draft for review

---

## Summary

Weekly leaderboard prizes (currently USD amounts paid manually via the
`weekly-payout-snapshot` admin flow) become merchant vouchers, auto-issued at
week close. Winners see a reveal sheet with **Claim** / **Burn for Miles**.
Vouchers live in the existing `/vouchers` wallet, where the burn decision
remains available until expiry. Every burn captures a required reason.

Guiding rules agreed in product discussion:

- The voucher is the winner's **from the moment settlement runs** — the win
  sheet is a reveal, not a claim gate. Dismissal = soft claim, never forfeit.
- Burn is always transparent: show Miles value and marketplace value side by side.
- No Miles are ever credited without a burn-reason row being written.
- All copy names the merchant **and location** ("Leshan Electronics, Mombasa,
  Kenya") so burn reasons are informed answers.

---

## Reuse map (what already exists)

| Existing piece | Where | Reused for |
|---|---|---|
| `VoucherWinSheet` (keep/burn celebration) | `components/claw/VoucherWinSheet.tsx` | Template for new `LeaderboardWinSheet` |
| Voucher wallet w/ status chips, tabs | `app/vouchers/page.tsx` | Home of won vouchers + burn entry point |
| `VoucherOrderSheet` (redemption) | `components/voucher-order-sheet.tsx` | Redemption path, unchanged |
| `issued_vouchers` + `spend_voucher_templates` + `spend_merchants` | Supabase / `app/api/Spend/vouchers/*` | Storage + issuance of prize vouchers |
| Weekly top-3 snapshot logic | `app/api/admin/weekly-payout-snapshot/route.ts` | Basis for auto-settlement job |
| Weekly leaderboard UI + countdown | `components/games/leaderboard-card.tsx` | Hosts sponsored-prizes banner |
| Games hub cards | `components/games/games-hub.tsx` | Sponsor copy + deep link |

---

## 1. One-time announcement modal

**Trigger:** first visit to `/games` (or any game page) after the feature flag
`NEXT_PUBLIC_SPONSORED_PRIZES` is on. Shown once; persisted per user
(profile flag preferred over localStorage so it survives devices — add
`seen_sponsored_prizes_announcement` to the user profile table).

**Content (single screen, dismissible):**

> **Leaderboard prizes are changing** 🎁
> Weekly USDT prizes are being replaced by merchant reward vouchers, starting
> with Leshan Electronics (Mombasa, Kenya).
> Win a top-3 spot → get a discount voucher. Can't use it? Burn it for Miles
> instead — your prize always has value.
> [Got it] [See this week's prizes →]

"See this week's prizes" scrolls to / opens the leaderboard weekly tab.

**Component:** `components/games/SponsoredPrizesAnnouncement.tsx` (Dialog or
bottom Sheet, matching `game-intro-sheet.tsx` styling).

## 2. Sponsored prizes banner

**Location A — `LeaderboardCard`, weekly tab.** Replace the current plain
countdown strip with a sponsored banner:

- Merchant logo + "This week's prizes by **Leshan Electronics**"
- Tier list: 🏆 25% off · 🥈 15% off · 🥉 10% off (each "up to KES X")
- Countdown (existing `useWeekCountdown`)
- CTA: "Shop & earn at Leshan →" — deep link to the merchant page in the hub,
  tagged `?src=games_banner` for impression→shop attribution.

**Location B — `games-hub.tsx`.** Update card stats: `"Miles + USDT"` →
`"Miles + Leshan rewards"` (driven by campaign config, not hard-coded).

**Data source:** new `GET /api/games/weekly-campaign` returning the active
campaign: `{ merchant: {name, logo, city, country, slug}, tiers: [{rank,
template_id, label, cap_kes, burn_miles, marketplace_miles}], week }`.
Backed by a `game_weekly_campaigns` table (see §6). Frontend never hard-codes
Leshan.

## 2b. Homepage banner: replace CrackPot with Akiba Pass / campaign

**Now:** `app/page.tsx` renders `CrackPotLaunchBanner` as the homepage hero
CTA whenever there's no featured raffle — a jackpot-themed banner with a
"Miles + USDT" chip. Off-message for the merchant direction.

**New:** `components/AkibaPassCampaignBanner.tsx` replaces it in the
`!featuredRaffle` slot. Same visual weight (full-width card, ~218px), content
driven by the active `game_weekly_campaigns` row — merchant logo, "Shop &
earn at Leshan Electronics", tier highlights. CTA branches on pass status
(existing prosperity-pass linkage):

- **No Akiba Pass** → route to `/prosperity-pass`: "Get your Akiba Pass —
  unlock merchant rewards" (pass onboarding already exists).
- **Has pass** → deep link to the hub merchant page, tagged `?src=home_banner`.

No active campaign → fall back to a generic Akiba Pass banner (never resurrect
the CrackPot banner as default; CrackPot remains reachable from the games hub).

**Analytics:** `home_banner_impression`, `home_banner_tap{has_pass}` — this
plus `?src=home_banner` gives homepage→shop attribution, separate from the
games banner (`src=games_banner`).

## 3. Settlement: auto-issue instead of manual payout

**Now:** admin fetches `weekly-payout-snapshot`, pays USDT manually.

**New:** scheduled job (cron in `packages/backend`, alongside existing
schedulers) at week close (Mon 00:05 UTC):

1. Compute top-3 per game for the closed ISO week (same query as the snapshot
   route).
2. For each winner, insert into `issued_vouchers` from the campaign tier's
   template with:
   - `acquisition_source: 'leaderboard_win'` (new enum value)
   - `win_meta: { game_type, week, rank, score }` (new jsonb column)
   - idempotency key `source_ref = '{game_type}:{week}:{rank}'` (unique
     index) — job can re-run safely.
3. Write a `leaderboard_prize_events` row (issued) for audit/analytics.

`weekly-payout-snapshot` route stays as a read-only audit view; the admin
page (`app/admin/weekly-payouts`) gets a "settled ✓ / voucher id" column
instead of copy-wallet-address buttons.

## 4. Win reveal sheet — `LeaderboardWinSheet`

**Component:** `components/games/LeaderboardWinSheet.tsx`, cloned from claw's
`VoucherWinSheet` (same Sheet + celebration structure, gold/silver/bronze
accent per rank).

**Trigger:** on app open / games page mount, `GET
/api/games/my-prizes?unseen=1` returns vouchers with
`acquisition_source='leaderboard_win'` not yet marked `win_seen_at`. If
multiple (user placed in 2+ games), one sheet listing all prizes.

**Content:**

> 🥈 **You placed 2nd in Memory Flip this week!**
> [Voucher card: **15% off** · on purchases up to KES 3,000 · at **Leshan
> Electronics, Mombasa, Kenya** · valid 30 days]
> or burn for **400 Miles** (worth 500 in the marketplace)
> [Claim my voucher]  [Burn for 400 Miles]

**Behavior:**

- **Claim** → mark `win_seen_at`, toast "Saved to your vouchers", deep link
  chip to `/vouchers`.
- **Burn** → opens Burn flow (§5).
- **Dismiss (X / swipe)** → mark `win_seen_at`, voucher stays `issued` in
  wallet. Never re-nag with the sheet; the wallet badge is the reminder.

## 5. Burn flow (conversion to Miles)

**Component:** `components/vouchers/BurnVoucherSheet.tsx`. Entered from the
win sheet or from the voucher detail in `/vouchers`. One sheet, three steps:

**Step 1 — Tradeoff.**
> This voucher is worth **500 Miles** in the marketplace.
> Burning gives you **400 Miles**. This can't be undone.

**Step 2 — Reason (required, one tap).**
> Why are you burning it?
> ○ I don't live in Kenya
> ○ The merchant is too far from me
> ○ I'm not interested in this merchant's products
> ○ I'd rather have Miles
> ○ Other [optional free text]

**Step 3 — Confirm →** Miles credited (existing Miles animation), voucher
status → `burned`, success state with new balance.

**API:** `POST /api/Spend/vouchers/[id]/burn` `{ reason, reason_text? }`.
Server-side, one transaction (Supabase RPC `burn_voucher_for_miles`):

1. Lock voucher; assert `status='issued'`, owner = session wallet, not expired.
2. Insert `voucher_burn_events` (see §6) — **insert fails ⇒ whole burn fails**.
3. Update voucher `status='burned'`.
4. Credit Miles via the existing mint/credit queue, `source='voucher_burn'`,
   `source_ref=voucher_id` (idempotent).

Burn value = `round(marketplace_miles × 0.80)`, computed server-side from the
campaign tier config at burn time. Never trust a client-supplied amount.

**Auto-burn at expiry:** a daily job burns any `issued` leaderboard voucher
past `expires_at` at **50%** of marketplace Miles (vs. 80% manual), writes a
`voucher_burn_events` row with `reason='expired'` (no survey), and credits
Miles through the same RPC. Winners never lose everything; deciding early
stays strictly better. Expiry copy in wallet: "Burns automatically for
250 Miles if unused by Aug 19."

**Geo-aware ordering:** user country comes from the **profile** (already
populated for most users; prompt once at burn time if missing). If profile
country ≠ merchant country, the wallet detail shows the burn option plainly
with copy
"Leshan is in Mombasa, Kenya. Not nearby? Burn for 400 Miles instead."
If same country, burn stays secondary/quiet. Win sheet layout is identical in
both cases (claim primary, burn secondary).

## 6. Data model changes (SQL)

```sql
-- issued_vouchers
ALTER TABLE issued_vouchers
  ADD COLUMN win_meta      jsonb,          -- {game_type, week, rank, score}
  ADD COLUMN win_seen_at   timestamptz,
  ADD COLUMN source_ref    text UNIQUE;    -- 'memory_flip:2026-W30:2'
-- new acquisition_source value: 'leaderboard_win'
-- new status value: 'burned'

CREATE TABLE game_weekly_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   uuid NOT NULL REFERENCES spend_merchants(id),
  week_from     date NOT NULL,
  week_to       date NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  tiers         jsonb NOT NULL
  -- [{rank:1, template_id, label:'25% off', spend_cap_kes:3000,
  --   marketplace_miles:750, burn_pct:0.80, expiry_burn_pct:0.50}, ...]
);

CREATE TABLE voucher_burn_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id     uuid NOT NULL REFERENCES issued_vouchers(id) UNIQUE,
  user_address   text NOT NULL,
  reason         text NOT NULL,       -- enum: not_in_country | too_far |
                                      -- not_interested | prefer_miles | other
  reason_text    text,
  miles_credited int  NOT NULL,
  marketplace_miles int NOT NULL,
  user_country   text,
  user_city      text,
  game_type      text,
  week           text,
  rank           int,
  merchant_id    uuid,
  sheet_shown_at timestamptz,         -- win_seen_at, for time-to-decision
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leaderboard_prize_events (   -- audit: every issuance
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid REFERENCES issued_vouchers(id),
  game_type text, week text, rank int, score int,
  user_address text, created_at timestamptz DEFAULT now()
);
```

## 7. Vouchers wallet changes (`app/vouchers/page.tsx`)

- "Won · 2nd place · Memory Flip" badge for `acquisition_source='leaderboard_win'`.
- Expiry countdown chip on active won vouchers ("12 days left").
- Detail actions: **Use at Leshan** (existing `VoucherOrderSheet` /
  redemption path) + **Burn for N Miles** (opens `BurnVoucherSheet`).
- New status chip: `burned` → "Burned for Miles" (gray, like redeemed).

## 8. Analytics events

`announcement_seen`, `banner_impression` (weekly tab render, throttled),
`banner_shop_cta_tap`, `win_sheet_shown`, `win_sheet_claim`,
`win_sheet_dismiss`, `burn_started`, `burn_completed{reason}`,
`won_voucher_redeemed`. Plus weekly engagement baseline: games played &
unique players per week (needed for the before/after USDT comparison —
capture at least 2 weeks of baseline **before** launch).

## 9. Rollout order

1. SQL migrations + `game_weekly_campaigns` seeded with Leshan campaign.
2. Settlement job (behind flag) — verify with a dry-run week against the
   snapshot route output.
3. Wallet changes + burn flow (testable via manually issued voucher).
4. Win sheet + my-prizes API.
5. Banners (leaderboard + homepage Akiba Pass swap) + announcement modal.
6. Flip flag at week open; announcement fires; first sponsored week runs.

Manual USDT payout stays available as fallback until the first settled week
is verified.

## 10. Decisions (resolved 2026-07-20)

- **Expiry:** 30 days, then auto-burn at **50%** of marketplace Miles
  (`reason='expired'`). Manual burn before expiry stays at 80%.
- **Caps:** single **KES 3,000 spend cap** across all tiers — "X% off
  purchases up to KES 3,000". Max discount value: 1st KES 750, 2nd KES 450,
  3rd KES 300. Max merchant exposure: KES 1,500/game/week → **KES 3,000/week**
  across both games. Pending Leshan sign-off on the 3K figure.
- **Geo:** user country from **profile** (already set for most users); prompt
  once during burn if missing.
- **Game scope:** `rule_tap` + `memory_flip` weekly boards only. Farkle's
  stake-based economy is untouched in the pilot.
