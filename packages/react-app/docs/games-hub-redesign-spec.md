# Spec: Games Hub Redesign — Prize Inbox + Economic Sections

**Package:** `packages/react-app`
**Depends on:** `docs/skill-games-voucher-prizes-spec.md` (shipped),
`docs/spend-earn-redesign-spec.md` (companion)
**Status:** Ready for implementation

---

## Context

The hub (`components/games/games-hub.tsx`, rendered at `/games`) is a flat
launcher list. Every game is a silo with its own win surface (`WinnerToast`,
`CrackPotWinnerToast`, claw `VoucherWinSheet`/`ClawSessionsList`, farkle
`settlement-status`, leaderboard `LeaderboardWinSheet`) and routes are
scattered (`/games/*`, `/crackpot`, `/claw`, `/dice`).

Redesign goals: (1) a cross-game **My Prizes** inbox, (2) sections that state
each game type's **economic contract**, (3) the **sponsored week** as the
hub's headline. Explicit non-goal: do NOT unify settlement/claim logic —
the inbox is a *feed with deep links*, each game keeps its own claim flow.

---

## 1. Page layout (top → bottom)

```
AppHeader
1. Sponsored week header        (campaign banner, hub-level)
2. My Prizes strip              (conditional — hidden when empty)
3. Weekly Challenge section     (rule_tap, memory_flip)
4. Head-to-Head section         (farkle)
5. Jackpot section              (crackpot, dice)
6. Prize Machines section       (claw)
7. Coming soon                  (existing `soon` entries)
LeaderboardWinSheet             (already mounted on this page)
SponsoredPrizesAnnouncement     (already mounted on this page)
```

## 2. Sponsored week header

- Data: `useWeeklyCampaign` (exists). Render only when `campaign?.merchant`.
- Content: merchant logo + "This week: **Leshan Electronics**", tier chips
  (🏆 25% · 🥈 15% · 🥉 10% — from `campaign.tiers[].label`), week countdown
  (reuse `useWeekCountdown` — extract it from `leaderboard-card.tsx` into
  `hooks/games/useWeekCountdown.ts` so both import it).
- Tap → scrolls to Weekly Challenge section.
- No campaign → render nothing (no placeholder).

## 3. My Prizes strip

### Data: new `GET /api/games/prize-feed` (session-authed)

Merges, newest first, capped 10:

| Source | Query | Feed entry |
|---|---|---|
| Leaderboard vouchers | `issued_vouchers` where `acquisition_source='leaderboard_win'` for wallet (reuse `/api/games/my-prizes` query) | `kind:'leaderboard_voucher'`, status from voucher (`issued`/`redeemed`/`burned`/`expired`), win_meta (game, week, rank, label) |
| Claw vouchers | same source as `/api/claw/vouchers/user/[address]` | `kind:'claw_voucher'`, status from `voucherStatus` |

Shape:

```ts
type PrizeFeedEntry = {
  id: string;
  kind: "leaderboard_voucher" | "claw_voucher";   // extensible: farkle, crackpot later
  title: string;        // "15% off at Leshan Electronics"
  subtitle: string;     // "🥈 2nd — Memory Flip · week 2026-W30"
  status: "action_needed" | "active" | "done" | "expired";
  cta: { label: string; href: string } | null;
  created_at: string;
  expires_at: string | null;
};
```

Status mapping: `issued` + unseen → `action_needed` ("Claim or burn");
`issued` seen → `active` ("View voucher" → `/vouchers`); `redeemed`/`burned`
→ `done`; `expired` → `expired`.

### UI: `components/games/MyPrizesStrip.tsx`

- Hidden entirely when the feed is empty (non-winners pay zero pixels).
- Header row: "My prizes" + badge with `action_needed` count.
- Shows the 2 most recent entries as compact rows (status dot, title,
  subtitle, CTA chevron). "See all" → expands inline to the full 10
  (no separate page in v1 — add `/games/prizes` only if history outgrows this).
- `action_needed` leaderboard entries → tapping opens `LeaderboardWinSheet`
  behavior (claim → `/vouchers`, burn → `BurnVoucherSheet`). Claw entries →
  `/claw` (its sessions list owns the claim flow).

## 4. Game sections

Restructure `GAMES` in `games-hub.tsx`: replace flat `category` with
`section`, render grouped with headers that state the deal:

| Section | Games | Header copy (subtitle) |
|---|---|---|
| `weekly` — **Weekly Challenge** | rule_tap, memory_flip | "Top 3 each week win {merchant} vouchers" (campaign-driven; fallback: "Top 3 each week win prizes") |
| `pvp` — **Head-to-Head** | farkle | "Stake Miles. Winner takes the pot." |
| `jackpot` — **Jackpot** | crackpot, dice | "Miles pots and live draws." |
| `machines` — **Prize Machines** | claw | "Spend Miles, win real merchant vouchers." |

- Dice gets a card in the hub (route `/dice`) — it's currently missing.
- Weekly Challenge cards: add a rank chip when the user has played this week
  — `useWeeklyLeaderboard(gameType).myBest` already returns the entry; show
  "You're #{rank}" (only when rank ≤ 20, else "Played this week ✓").
- Card visuals/`stats` copy: keep existing per-game entries; remove any
  remaining USDT strings from farkle/crackpot/dice cards → "Miles pot" /
  "Winner takes pot" (copy only; game economics unchanged in this spec).

## 5. Route normalization (stretch — separate PR)

`/crackpot` → `/games/crackpot`, `/claw` → `/games/claw`, `/dice` →
`/games/dice` via folder moves + `next.config.js` permanent redirects from
the old paths. Update `GAMES[].route`, bottom-nav `isActive` checks
(`/dice` special case), and any internal `<Link>`s. Do not block the hub
redesign on this.

## 6. Analytics

`hub_view`, `sponsored_header_impression{merchant_id}`,
`prize_strip_impression{action_needed_count}`, `prize_entry_tap{kind,status}`,
`section_game_tap{section, game}`, `rank_chip_impression{game, rank}`.

## 7. Acceptance criteria

- Hub renders 4 sections in order with header copy; dice card present.
- With an active campaign: sponsored header shows merchant + tiers +
  countdown; Weekly Challenge subtitle names the merchant.
- User with an unseen leaderboard win: My Prizes strip shows badge ≥1;
  tapping the entry reaches claim/burn; after burn the entry flips to `done`
  without reload (refetch feed on sheet close).
- User with no prizes ever: no My Prizes strip rendered.
- `useWeekCountdown` extracted and used by both hub header and
  `leaderboard-card.tsx` (no duplicated countdown logic).
- No USDT strings remain in `games-hub.tsx`.
- Typecheck + existing tests pass.

## 8. Open questions

1. Should farkle claimable-settlement rows join the prize feed in v1
   (read-only, linking into farkle's own claim UI), or wait for v2?
   Recommend v2 — farkle settlement states are more complex than voucher
   statuses and shouldn't delay the strip.
2. Rank chip threshold: top 20 cut-off is arbitrary — tune after seeing
   weekly player counts.
3. When route normalization lands, do old share links (`/crackpot` deep
   links in social posts) matter enough to keep redirects permanently?
   (Recommend: yes, redirects are cheap.)
