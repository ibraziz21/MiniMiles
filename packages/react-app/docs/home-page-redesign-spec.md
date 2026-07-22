# Spec: Home Page Redesign — Weekly Moment + Value Pulse

**Package:** `packages/react-app` (`app/page.tsx`)
**Depends on:** `docs/skill-games-voucher-prizes-spec.md`,
`docs/games-hub-redesign-spec.md`, `docs/weekly-challenge-page-spec.md`
(campaign hooks, prize feed, win sheet, `/games/challenge` all exist)
**Status:** Ready for implementation

---

## Context

Home is the front door. Its job in one sentence: *"here's this week's
sponsored moment, here's your streak, here's your unredeemed value."*
Today it leads with Akiba-funded token raffles ("50 USDT" hero), carries a
USDT Farkle promo, and never surfaces prizes or vouchers.

**Decisions locked:**
- Farkle banner: **removed** (game keeps its hub tile).
- Hero precedence: **enforced in code** — campaign > featured raffle > Pass banner.
- Value pulse: **vouchers + weekly rank**.

## Page order (top → bottom)

```
AppHeader
1. Hero (precedence-enforced)
2. Daily challenges          (unchanged, incl. header link to /earn)
3. Value pulse strip         (conditional)
4. More rewards              (raffle carousel, sponsored-first sort)
5. MigrateV2Banner           (unchanged, until migration completes)
6. ProfileCtaCard            (copy tweak, see §5)
Sheets: PhysicalRaffleSheet, SpendPartnerQuestSheet (unchanged)
LeaderboardWinSheet          (NEW mount — see §2)
ReferFab
```

`RewardFarkleBanner` component + usage: **delete** (function lives in
`app/page.tsx` ~line 137; remove entirely, no orphaned imports).

## 1. Hero precedence (in code)

```
const { campaign } = useWeeklyCampaign();

if (campaign?.merchant)      → <HomeCampaignHero />        // NEW
else if (featuredRaffle)     → <CampaignHero />            // existing raffle hero
else                         → <AkibaPassCampaignBanner /> // existing
```

**`HomeCampaignHero`** (`components/HomeCampaignHero.tsx`): slim variant of
the games hub's `WeeklyChallengeHero` — dark card, "Weekly Challenge" +
sponsor name/logo, tier chips, countdown (`useWeekCountdown`), single CTA
row "Play & win →". Whole card links to `/games/challenge`. No game tiles
here (home stays light; play lives one tap away). Reuse the hub hero's
styling constants — extract shared bits only if trivial, do not refactor the
hub hero for this.

Note: a live token raffle no longer outranks a campaign. During sponsored
weeks the raffle still appears in the More Rewards carousel (§4).

## 2. Win reveal on home

Mount `<LeaderboardWinSheet />` in `app/page.tsx` (it already dedupes via
`win_seen_at` and renders null with no unseen prizes — mounting on both home
and `/games` is safe and intended; winners land on home Monday morning).

## 3. Value pulse strip

`components/ValuePulseStrip.tsx`. Up to two slim rows under Daily
Challenges; entire strip hidden when neither applies.

| Row | Condition | Copy | Tap → |
|---|---|---|---|
| Vouchers | ≥1 voucher `status='issued'` (from `/api/games/prize-feed` — includes won + claw; use `expires_at`) | "🎟 {n} voucher{s} · {m} expiring soon" (expiring = within 7 days; omit clause when 0) | `/vouchers` |
| Rank | played this week in any weekly game (`useWeeklyLeaderboard` myBest per game; show best rank across games) | "🏆 You're #{rank} in {game} · {countdown} left" (rank > 20 → "You're on the {game} board") | `/games/challenge` |

Style: quiet rows (white card, 1-line, chevron) — a whisper, not a banner.
Analytics: `value_pulse_impression{rows}`, `value_pulse_tap{row}`.

## 4. More rewards carousel

- Keep existing carousel + sheets.
- Sort: sponsored/physical merchant raffles first when they exist (flag on
  raffle data — if no such flag exists yet, keep current order and leave a
  `TODO(sponsored-sort)`; do NOT invent a raffle schema change in this PR).
- Existing token/USDT raffles age out naturally — no removals.
- Section link target stays `/spend` (now the deals page — correct).

## 5. ProfileCtaCard

Copy emphasis: completing country unlocks local rewards ("Add your country —
get prizes you can actually use"). Data already feeds geo routing + burn
analytics. Copy-only change.

## 6. Analytics

`home_view`, `home_hero_variant{campaign|raffle|pass}`, `home_hero_tap{variant}`,
plus §3 events. Keep existing raffle events untouched.

## 7. Acceptance criteria

- With active campaign: campaign hero renders (raffle demoted to carousel),
  links to `/games/challenge`.
- No campaign + featured raffle: existing raffle hero. Neither: Pass banner.
- Farkle banner gone; no dead code.
- Winner with unseen prize sees win sheet on home open.
- Pulse strip: correct rows for (vouchers only / rank only / both / neither).
- Typecheck + tests pass.

## 8. Open questions

1. Sponsored-raffle flag/schema — define when the first merchant raffle is
   actually negotiated (deliberately out of scope here).
2. Should the pulse rank row rotate between games if the user ranks in both?
   V1: show the better rank; revisit if users complain.
