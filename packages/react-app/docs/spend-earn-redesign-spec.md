# Spec: Spend & Earn Redesign — Engagement Layer v2 (first handoff)

**Package:** `packages/react-app`
**Depends on:** `docs/skill-games-voucher-prizes-spec.md` (shipped on this branch)
**Status:** Ready for implementation

---

## Context

The engagement layer's job is audience, habit, and discovery; commerce lives in
the Akiba Pass (pass.akibamiles.com). Under that split, two surfaces are
currently wrong:

- **`/spend` renders the Games hub** (a duplicate of `/games`). Users who earn
  Miles and open "Spend" are pointed back at games — Miles have no visible
  purpose.
- **The Earn tab's quests grow other apps** (YouTube/X follows for web3
  partners), not merchant discovery.

This spec fixes both. Nothing is removed that users love; funding and
direction change.

## Goals / non-goals

**Goals**

1. `/spend` becomes a merchant-deals + voucher surface with a Pass handoff and
   a Games entry point.
2. Earn tab: daily challenges untouched; partner quests replaced by merchant
   discovery quests on the existing quest engine.

**Non-goals (explicitly out of scope)**

- No full storefront/marketplace in this app — browsing depth lives in the Pass.
- No changes to games, raffles, vault, badges, Prosperity Pass.
- No removal of the quest engine or claim infrastructure.
- No renaming of the bottom-nav tab (open question #1).

---

## 1. Spend page (`app/spend/page.tsx`)

Replace the current `<GamesHub />` render entirely. New layout, top to bottom:

### 1a. Header
Existing `AppHeader`. Page title "Spend".

### 1b. My Vouchers strip
- Row card: ticket icon, "My vouchers", count of active vouchers
  (`status='issued'`, from `/api/Spend/vouchers/user/[address]` — response
  already includes won vouchers with `win_meta`).
- If any won voucher is unseen or expiring within 7 days, show an amber dot +
  "1 expiring soon".
- Tap → `/vouchers` (page exists; its back arrow already returns to `/spend`).
- Zero vouchers → keep the row, subtitle "Win them in games or grab a deal below".

### 1c. Merchant deals (available vouchers)
- Section title: "Merchant deals".
- Data: **new route** `GET /api/Spend/deals` → active `spend_voucher_templates`
  (active, not expired, not sold out) joined with `spend_merchants`
  (name, image, country) — mirror the query pattern of
  `/api/Spend/vouchers/user/[address]` (template + merchant join, no FK
  auto-detection). Order: featured/newest first, cap 10.
- Card per deal: merchant logo + name, deal label (reuse `discountLabel()`
  logic from `app/vouchers/page.tsx`), Miles price (`miles_cost` with
  `MilesAmount` component), scope line (category / product) if set.
- Tap → existing purchase flow: `components/merchant-voucher-sheet.tsx` →
  `/api/Spend/vouchers/issue` (Miles burn + signature + idempotency — all
  existing; do NOT build new purchase logic).
- Empty state (no active templates): "New deals landing soon" + Pass CTA.

### 1d. Akiba Pass CTA
- Card: "Use your Miles in real shops — get your Akiba Pass".
- Tap → `/akiba-pass?src=spend_page` (onboarding carousel exists; final CTA
  opens pass.akibamiles.com in the phone's browser via `lib/openExternal.ts`).

### 1e. Games nav card
- Compact banner: "Play & win merchant vouchers" + this week's sponsor if a
  campaign is active (`useWeeklyCampaign` hook exists — show merchant name +
  top tier label).
- Tap → `/games`.

### Cleanup
- `/spend` no longer imports `GamesHub`.
- `/games` remains the only games surface (bottom nav already links it).

## 2. Earn page (`app/earn/page.tsx`)

### 2a. Daily challenges — unchanged
`DailyChallenges` stays exactly as is. (Future: merchant-relevant challenge
content — config change, not code; out of scope here.)

### 2b. Partner quests → Merchant discovery quests
Replace usage of `components/partner-quests.tsx` on the Earn page with a new
`components/merchant-discovery-quests.tsx` built on the same pattern
(quest groups → quest cards → claim sheet → Supabase claim tracking).
Keep `partner-quests.tsx` in the tree (paid partner inventory may return —
see open question #2) but unmounted.

**Launch quest catalog (seed data, not hard-code where avoidable):**

| Quest | Verification | Reward (suggested) |
|---|---|---|
| Get your Akiba Pass | Phase 1: click-trust (opened `/akiba-pass` flow). Phase 2: verified via hub account-link check (see §3) | 20 Miles (phase 1) + 100 Miles verified bonus (phase 2) |
| Browse this week's merchant deals | Click-trust: opened a deal card on `/spend` | 5 Miles, once |
| Play the sponsored leaderboard | Server-verified: `skill_game_sessions` row for a campaign `game_type` this week | 25 Miles, weekly |
| Complete your profile (country) | Server-verified: `users.country` set | 50 Miles, once — feeds geo-aware prize routing |
| Redeem your first voucher | Server-verified: any `issued_vouchers.status='redeemed'` for wallet | 100 Miles, once |

**Rules:**
- Verification tier determines reward size: click-trust quests stay ≤ 20 Miles
  (gameable), server-verified quests pay more.
- Claim flow reuses the existing claim path (`QuestClaimSheet` /
  quest claim API + mint queue). Server-verified quests check their condition
  in the claim API before minting — same pattern as existing
  `pretium_signup`/`pretium_transact` gated quests (`questType` field).
- Quest definitions: extend the existing quest storage (Supabase quest rows +
  IDs, as `partner-quests.tsx` does today) — do not invent a new system.

## 3. New backend touchpoints

1. `GET /api/Spend/deals` — public, cached (revalidate 300): active templates
   + merchant join (see §1c).
2. Quest verification checks inside the existing quest-claim API for the three
   server-verified quests (game session this week / country set / voucher
   redeemed). All three read tables that already exist in this app's Supabase.
3. **Deferred (phase 2):** `GET /api/pass/link-status?address=…` — checks the
   hub DB for an account linked to this wallet/email, used by the verified
   Pass quest bonus. Cross-system; ship the rest without it.

## 4. Analytics

`spend_page_view`, `deal_card_tap{template_id}`, `deal_purchase{template_id}`,
`my_vouchers_tap`, `pass_cta_tap{src:'spend_page'}`, `games_card_tap`,
`quest_claim{quest_id, verified:boolean}`. PostHog provider already mounted.

## 5. Acceptance criteria

- `/spend` shows vouchers strip, ≥1 deal card when a template is active, Pass
  CTA, and Games card; no `GamesHub` import.
- Buying a deal end-to-end: tap card → sheet → Miles burned → voucher appears
  in `/vouchers` (existing flow, must still pass).
- Earn page renders discovery quests; partner quest groups no longer visible.
- "Play the sponsored leaderboard" quest is claimable only after an accepted
  `skill_game_sessions` row this ISO week, and only once per week.
- "Complete your profile" quest is claimable only when `users.country` is set.
- Typecheck + existing tests pass.

## 6. Open questions

1. Tab label: keep **"Spend"** at launch (recommended — no nav retraining) or
   rename to "Deals"? Revisit post-pilot.
2. Old partner quests: permanently retired, or kept as a collapsed "Partner
   offers" section sold as paid inventory? Launch without; decide when a
   partner pays.
3. Deal inventory for launch week: Leshan templates only, or pad with 1–2
   Akiba-funded "house deals" so the shelf isn't single-merchant? (House deals
   cost Akiba, but an empty-looking shelf costs trust.)
