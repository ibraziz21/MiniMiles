# Spec: Weekly Challenge Page (`/games/challenge`)

**Package:** `packages/react-app`
**Depends on:** `docs/games-hub-redesign-spec.md` (hero shipped),
`docs/skill-games-voucher-prizes-spec.md` (campaigns, prizes, settlement — shipped)
**Status:** Ready for implementation

---

## Context

The weekly leaderboard is the campaign surface — the thing merchants sponsor —
but it only exists as a widget inside each game page. This spec gives the
week-long competition one destination: campaign frame, both game boards,
prize zone, your pinned rank, and last week's results.

**Decisions already made:**
- Route: `/games/challenge`, with the hub hero as its front door. No nav change.
- Per-game prize boards stay separate — NO merged cross-game score.
- Winner showcase: **username only** (no redemption proof, no location).
- Daily leaderboards stay inside game pages, untouched.

**Non-goals:** push notifications / overtaken alerts; season or league layer;
any change to settlement.

---

## 1. Entry points

1. **Hub hero** (`WeeklyChallengeHero` in `games-hub.tsx`): the hero block
   body navigates to `/games/challenge`. The two game tiles inside keep
   navigating directly to their games (play stays one tap). Add a subtle
   "View standings →" row at the hero's bottom edge.
2. **Post-game result sheet** (`components/games/game-result-sheet.tsx`):
   after an accepted weekly-eligible run, show "You're **#6** in
   {game} this week" + delta nudge line (§4) + "View standings" →
   `/games/challenge`. Data: refetch `useWeeklyLeaderboard(gameType)` after
   settlement; no before/after movement tracking in v1.
3. **Home value pulse** (future home spec) links here — out of scope now.

## 2. Page layout (`app/games/challenge/page.tsx`)

```
AppHeader (back → /games)
1. Campaign frame     merchant logo+name / "Weekly Challenge", tier chips,
                      countdown (useWeeklyCampaign + useWeekCountdown).
                      No campaign → generic frame, page still works.
2. Tabs               [ This week | Last week ]
3. Per game (rule_tap, memory_flip — from campaign.gameTypes when active,
   else WEEKLY_GAME_TYPES constant):
     - Game header: icon, name, "Top 3 win vouchers"
     - YOUR ROW (pinned, always visible if you played): rank, score,
       highlighted style — shown ABOVE the board, not buried in it
     - Delta nudge line (§4)
     - Board: top 10, with PRIZE ZONE styling on ranks 1–3 (§3)
     - Empty state: "No entries yet — be first on the board" + Play CTA
```

## 3. Prize zone (ranks 1–3)

- Rows 1–3 carry the prize inline: rank medal + username + score + prize
  chip ("25% off" — label from `campaign.tiers`; generic 🏆/🥈/🥉 when no
  campaign).
- Visual cut line between rank 3 and 4 ("— prize zone —" divider).
- Reuse `EntryRow` patterns from `components/games/leaderboard-card.tsx`
  (avatar bg, username/shortAddress display) — extract shared pieces into
  `components/games/leaderboard-shared.tsx` rather than duplicating.

## 4. Delta nudge

One line under the user's pinned row. Logic:

| Situation | Copy |
|---|---|
| Rank 1 | "You're in the lead — defend it 🏆" |
| Rank 2–3 | "You're in the prize zone — {pts to rank above} pts to climb" |
| Rank 4+ | "{pts} pts from 3rd place — a {tier-3 label} voucher" |
| Played, board < 3 entries | "Prize zone is wide open" |
| Not played this week | "Play {game} to get on the board" + Play link |

`pts` = (score at target rank) − (your best) + 1. Data is already in the
weekly leaderboard response (entries + myBest).

## 5. Last week tab

### Data: new `GET /api/games/challenge/last-week`

- Week = `lastClosedWeek()` (exists in `lib/games/week.ts`).
- Per game type:
  - **Winners**: from `leaderboard_prize_events` for that week joined to
    `issued_vouchers.win_meta` → `{rank, username, score, prizeLabel}`.
    Username via `users` lookup (same pattern as weekly-payout-snapshot).
    **Username only** — no wallet display beyond the existing
    shortAddress fallback, no location, no redemption status.
  - **Standings**: top 10 computed from `skill_game_sessions` for the week
    range — extract the best-per-wallet/top-N logic already written in
    `app/api/admin/settle-weekly-prizes/route.ts` into a shared server
    helper (`lib/games/weeklyStandings.ts`) used by both routes. Do not
    duplicate it a third time.
- Cache: revalidate 3600 (closed week never changes).

### UI

Same board layout as This Week, read-only, winners' rows show their prize
chip filled ("won 15% off"). Header: "Week {label} results".

## 6. Analytics

`challenge_page_view{tab, has_campaign}`, `challenge_play_tap{game}`,
`delta_nudge_impression{situation}`, `result_sheet_standings_tap{game}`,
`hero_standings_tap`.

## 7. Acceptance criteria

- `/games/challenge` renders both boards with top 10, prize-zone styling on
  1–3, and the divider; works with and without an active campaign.
- User who played: pinned row + correct delta nudge per §4 table (unit-test
  the nudge function).
- Last week tab shows winners (username only) + final top 10; matches what
  settlement actually issued for that week.
- Hub hero navigates to the page; game tiles still go to games.
- Result sheet shows current weekly rank + nudge after an accepted run and
  links to the page.
- Standings logic is shared between settlement route and last-week route
  (single helper), covered by an existing-behavior test (same input → same
  top 3 as settlement).
- Typecheck + tests pass.

## 8. Open questions

1. Board depth: top 10 now; if weekly player counts grow past ~200, add
   "show 11–50" expansion — defer.
2. Should the Last Week tab deep-link from the winners' announcement
   (win sheet "see final standings")? Nice-to-have; defer unless trivial.
