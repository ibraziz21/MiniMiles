# Walletless skill games in Akiba Pass

**Packages:** `packages/skill-games`, `packages/react-app`, `packages/hub-page`, `packages/backend`  
**Games:** Memory Flip and Rule Tap  
**Status:** Proposed  
**Purpose:** Implementation contract  
**Navigation change:** Replaces the Akiba Pass Rewards page with Games

## 1. Decision

Akiba Pass will offer the two existing React skill games:

1. Memory Flip
2. Rule Tap

The Pass versions are authenticated, server-authoritative Web2 games. Playing
does not require a wallet, an on-chain game session, a ticket, Miles, gas, or a
transaction signature.

Each canonical member may start each game at most five times per calendar day.
The limit is independent per game, so a member may start at most ten rewarded
rounds per day across both games.

> **Daily-limit interpretation:** This specification treats “a maximum of five
> times” as five starts per game per Nairobi calendar day. That follows the
> existing React product model, which already has a per-game daily cap. If the
> intended limit is five lifetime starts instead, the scope key changes from a
> Nairobi date to `lifetime`; the rest of the design is unchanged.

Scoring, timing, anti-abuse checks, and per-round Miles thresholds remain the
same as React. Reward delivery depends only on the verified identity available
when the authoritative result is finalized:

- a member without a verified wallet receives one off-chain `miles_ledger`
  credit;
- a member with a verified wallet receives one `minipoint_mint_jobs` job, which
  the existing Backend mint worker delivers on-chain;
- gameplay itself remains fully Web2 in both cases;
- linking a wallet after an off-chain reward never mints that reward again.

The React app and Pass must render the same shared game experiences. Pass must
not receive copied components that can drift independently.

## 2. Required invariants

1. A member never spends Miles or a ticket to start a Pass round.
2. A member can start no more than five Rule Tap rounds and five Memory Flip
   rounds per Nairobi calendar day.
3. Limits are keyed by canonical identity, not email, browser, or wallet.
4. Linking or changing a wallet does not reset a play limit.
5. Only server-held state determines score, acceptance, and reward.
6. A finalized session creates at most one reward delivery.
7. A reward delivery uses exactly one mode: off-chain ledger or on-chain mint.
8. An off-chain reward is never minted later merely because a wallet was linked.
9. A confirmed on-chain mint is never retried because a follow-up database write
   failed.
10. Repeating `start`, `finish`, worker, status, or recovery requests is
    idempotent.
11. Existing React wallet sessions and contract settlement continue to work.
12. The same accepted Pass game session can prove the weekly
    `sponsored_game_played` partner quest without requiring a wallet.
13. A browser can never select its canonical ID, Hub user ID, payout mode,
    destination wallet, score, or reward amount.
14. A database or Backend outage must fail closed before consuming a playable
    round whenever the authoritative session was not created.

## 3. Scope

### 3.1 Included

- shared Memory Flip and Rule Tap presentation and play components;
- shared game types, configuration, and scoring constants;
- authenticated Pass games home and game routes;
- five free starts per game per Nairobi day;
- current React scoring and reward thresholds;
- server-authoritative init, action, finish, and recovery;
- canonical identity ownership;
- off-chain ledger delivery for walletless members;
- normal MiniPoints mint jobs for members with a verified wallet;
- daily and weekly score leaderboards using both wallet and canonical players;
- walletless sponsored-game quest evidence;
- replacement of the Pass Rewards navigation and page;
- rollout, recovery, health, analytics, and reconciliation.

### 3.2 Explicitly excluded from Pass v1

- the Akiba Skill Games contract;
- `startGame`, `buyCredits`, `settleGame`, or any other game-contract call;
- tickets, ticket bundles, entry fees, Miles burns, or payment;
- stablecoin rewards;
- Farkle, CrackPot, Akiba Claw, or other React game surfaces;
- wallet-to-wallet competition;
- React's `BuyPlaysSheet`, `useCredits`, contract-backed `useGameSession`, or
  skill-game settlement-status flow;
- automatically bridging an existing off-chain ledger reward on-chain;
- weekly merchant voucher-prize issuance in Pass v1.

Pass entries may appear in the shared score leaderboard and may satisfy the
sponsored-game quest. Any future weekly voucher-prize eligibility needs a
separate product and fraud review.

## 4. Existing behavior to preserve

The implementation must preserve these current React and Backend rules.

### 4.1 Scoring and rewards

| Game | Score | Reward thresholds |
|---|---|---|
| Rule Tap | `max(0, correct - mistakes * 2)` | 10+: 6 Miles; 14+: 9 Miles; 18+: 12 Miles |
| Memory Flip | completion/pairs + time bonus + efficiency bonus − mistake penalty | 200+: 6 Miles; 500+: 9 Miles; 750+: 12 Miles |

Memory Flip uses:

```text
completion       = completed ? 500 : matches * 45
timeBonus        = completed ? max(0, round((60,000 - elapsedMs) / 100)) : 0
efficiencyBonus  = max(0, 240 - moves * 10)
score            = max(0, completion + timeBonus + efficiencyBonus - mistakes * 15)
```

Rule Tap remains a 20-second round. Memory Flip remains a 60-second, eight-pair
round. Rewards below the first threshold are zero.

At the maximum score tier, the Pass reward budget is bounded at:

```text
5 Rule Tap starts × 12 Miles + 5 Memory Flip starts × 12 Miles
= 120 Miles per canonical member per Nairobi day
```

This exposure is intentional and must be visible in rollout dashboards.

### 4.2 Server authority

Continue using the pure Backend engines in:

- `packages/backend/src/games/memoryFlipServer.ts`
- `packages/backend/src/games/ruleTapServer.ts`
- `packages/backend/src/games/score.ts`

The existing behavior remains authoritative:

- Memory Flip uses a Backend-generated seed and deck, mirrors ordered flips,
  enforces the evaluation lock, and computes the final score on the server.
- Rule Tap keeps the timeline secret, reveals tiles just in time, stamps live
  actions against the server clock, prevents duplicate target scoring, and
  computes the final score on the server.
- the existing impossible-speed and repeated-timing flags remain recorded;
- blocking flags produce zero reward while retaining the result for audit.

Removing the on-chain start must not switch Pass to the mock verifier or
client-generated replay path.

## 5. Component reuse contract

### 5.1 Shared workspace package

Create a workspace package:

```text
packages/skill-games/
  package.json                 # @akiba/skill-games
  src/core/config.ts
  src/core/score.ts
  src/core/types.ts
  src/client/transport.ts
  src/client/useMemoryFlipGame.ts
  src/client/useRuleTapGame.ts
  src/client/MemoryFlipExperience.tsx
  src/client/RuleTapExperience.tsx
  src/components/...
```

Move reusable files out of `packages/react-app`; do not copy them. Update React
imports to `@akiba/skill-games` in the same change so React continues exercising
the shared implementation.

`src/core` is runtime-neutral and is also imported by `packages/backend`. It is
the single source for game names/types, durations, score formulas, and 6/9/12
Miles thresholds. Delete the duplicate scoring/config definitions from the
React and Backend packages after parity tests pass. Server engines and both
frontends must calculate from the same exported fixtures/functions.

Economy policy is deliberately not part of that shared gameplay config:

```text
React adapter -> contract tickets and its existing daily cap
Pass adapter  -> free entry and daily cap 5
```

Changing Pass to five free starts must not silently change React's current cap
or ticket behavior.

Both Next apps must add `@akiba/skill-games` to `transpilePackages`. Both
Tailwind configurations must scan `../skill-games/src/**/*.{ts,tsx}` so shared
classes are emitted. The package must support the repository's current React
18/19 and Next 14/16 split through compatible peer ranges and must not import
app-private `@/...` aliases.

### 5.2 Components reused unchanged or with presentation-only props

These current React components are the primary reuse targets:

- `memory-flip/memory-card.tsx`
- `memory-flip/memory-grid.tsx`
- `memory-flip/memory-stats.tsx`
- `rule-tap/rule-banner.tsx`
- `rule-tap/rule-tap-board.tsx`
- `rule-tap/rule-tap-score-panel.tsx`
- `miles-amount.tsx`
- `reward-thresholds.tsx`
- `submitting-overlay.tsx`
- `game-card.tsx`

These components require adapters before sharing:

- `GameHeader`: accept `gamesHomeHref`, brand label, and Miles icon instead of
  hard-coding React routes and app-private SVG imports.
- `GameIntroSheet`: accept `entryMode="free" | "ticket"`. Free mode says “Free
  play”, shows remaining daily starts, and contains no ticket or purchase CTA.
- `GameResultSheet`: accept `standingsHref`, analytics callbacks, and neutral
  reward-delivery copy. It must not import PostHog directly.
- `LeaderboardCard`: accept `viewerKey` and a leaderboard transport. It must not
  call `useWeb3` or infer “you” from a wallet.

The shared package owns small UI primitives it needs, or receives primitives by
props. It must not import React app's private `Button`, `Sheet`, SVG, Web3, or
PostHog modules.

### 5.3 Shared experience components

Extract the current game-page orchestration into:

```ts
<RuleTapExperience adapter={adapter} />
<MemoryFlipExperience adapter={adapter} />
```

Each experience owns the current board, countdown, score display, intro,
result, action flushing, and play-again flow. The host app supplies:

```ts
type SkillGameAdapter = {
  gamesHomeHref: string;
  standingsHref: string;
  getStatus(gameType: GameType): Promise<GamePlayStatus>;
  start(gameType: GameType, idempotencyKey: string): Promise<ClientGameSession>;
  init(sessionId: string): Promise<InitResponse>;
  flip(sessionId: string, input: FlipInput): Promise<FlipResponse>;
  tick(sessionId: string): Promise<TickResponse>;
  tap(sessionId: string, input: TapInput): Promise<TapResponse>;
  finish(sessionId: string): Promise<FinishResponse>;
  recover(sessionId: string): Promise<RecoveryResponse>;
  leaderboard(gameType: GameType, scope: "daily" | "weekly"): Promise<LeaderboardResponse>;
  track(event: string, properties?: Record<string, unknown>): void;
};
```

Identity, wallets, chain calls, cookies, and payout selection are deliberately
absent from this browser contract.

### 5.4 React-only code

The React app retains adapters for:

- `useWeb3`;
- the game contract and on-chain start;
- ticket status and purchase;
- legacy skill-game settlement and recovery;
- React-specific weekly prize surfaces.

Pass must never import those adapters.

## 6. Pass routes and UX

### 6.1 Navigation replacement

Replace Rewards with Games throughout Akiba Pass:

| Current | New |
|---|---|
| Desktop `/rewards` tab | `/games`, label “Games” |
| Mobile `/rewards` item | `/games`, label “Games” |
| PWA “Rewards” shortcut | “Games” → `/games` |
| Home Miles tile `/rewards` target | `/games` |
| `/rewards` page | permanent redirect to `/games` |

`GET /api/rewards` may remain temporarily for compatibility but is no longer
used by mounted Pass UI. Remove it only after traffic confirms there are no
external consumers.

Add `/games` to Hub middleware's protected paths. Unauthenticated visitors are
redirected to `/login?next=/games...`.

### 6.2 Games home

`/games` shows only Memory Flip and Rule Tap. It must not reuse React's complete
`GamesHub`, because that component also advertises Farkle, CrackPot, Claw,
weekly prizes, and ticket entry.

Each launcher shows:

- game name and existing visual theme;
- current maximum reward: 12 Miles;
- “Free to play”;
- `N of 5 played today` and `5 - N` remaining;
- the member's best accepted score today when available;
- a Play CTA or “5/5 played today · Come back tomorrow”.

Status is loaded server-side for the first render and refreshed after every
finish. A status outage disables Play and says the service is unavailable; it
must never assume that five plays remain.

### 6.3 Game pages

Routes:

```text
/games/rule-tap
/games/memory-flip
```

Differences from React UI are limited to the economy and identity copy:

- “Free play”; no ticket language;
- “X/5 played today”; no credits balance;
- no Buy Tickets button or sheet;
- no wallet-connect prompt;
- no transaction, gas, contract, or settlement-hash language;
- result state says `Reward added`, `Reward minting`, `No reward`, `Result
  rejected`, or `Reward needs attention`;
- Play Again is disabled as soon as the fifth start is reserved.

The score shown during play may be provisional. The result sheet adopts the
Backend's final score and reward before reporting acceptance.

## 7. Identity and trust boundary

### 7.1 Browser to Pass

Every Pass game route uses the Supabase server session. The browser submits
only game inputs and a session ID. It never submits:

- `hubUserId`;
- email;
- `canonicalId`;
- wallet address;
- payout mode;
- score or reward amount.

All mutation routes enforce JSON content type, same-origin requests, request
size limits, and the existing Hub rate-limit conventions.

### 7.2 Pass to Backend

Pass acts as the authenticated BFF. On every Backend call it:

1. loads the Supabase user from the cookie session;
2. resolves the stable canonical participant using
   `resolve_partner_quest_canonical`/`hub_user_canonicals`;
3. signs a short-lived service assertion;
4. sends the assertion to the Backend over HTTPS;
5. forwards only permitted game input.

The assertion contains:

```json
{
  "iss": "hub-page",
  "aud": "skill-games-backend",
  "sub": "<canonical-id>",
  "hubUserId": "<auth.users.id>",
  "method": "POST",
  "path": "/games/web2/session/flip",
  "iat": 0,
  "exp": 0,
  "jti": "<random-id>"
}
```

Use an asymmetric signature where operationally available; otherwise use a
dedicated rotating HMAC secret that is not shared with browser code. Assertions
expire within 60 seconds and are bound to method and Backend path.

The Backend rejects missing, expired, replayed, incorrectly scoped, or
wrong-audience assertions. A generic API key without participant-bound claims
is insufficient.

### 7.3 Session ownership

Every Pass game session stores `canonical_id` and `hub_user_id`. Every action
loads the session and compares its stored canonical participant with assertion
`sub`. The Backend never uses request-body identity for ownership.

The verified payout wallet is resolved server-side at finish time and stored as
a delivery snapshot. It is never the game-session owner.

## 8. API contract

Pass exposes same-origin BFF routes. Backend handlers use a `/games/web2`
namespace so existing React routes continue unchanged during rollout.

### 8.1 Status

```http
GET /api/games/status?gameType=rule_tap
```

```json
{
  "gameType": "rule_tap",
  "dailyCap": 5,
  "playsToday": 2,
  "playsRemaining": 3,
  "nextResetAt": "2026-08-06T00:00:00+03:00",
  "bestScoreToday": 14,
  "serviceAvailable": true
}
```

Status is canonical-identity scoped. It never accepts a wallet query parameter.

### 8.2 Start

```http
POST /api/games/session/start
Idempotency-Key: <uuid>
Content-Type: application/json

{ "gameType": "memory_flip" }
```

Successful response:

```json
{
  "sessionId": "<uuid>",
  "gameType": "memory_flip",
  "status": "reserved",
  "playsToday": 3,
  "playsRemaining": 2,
  "expiresAt": "..."
}
```

Errors:

- `401 unauthenticated`;
- `409 daily-cap-reached`;
- `409 idempotency-conflict`;
- `429 rate-limited`;
- `503 game-service-unavailable`.

The same idempotency key and participant returns the same reservation. Reusing
the key with another game or participant is a conflict.

### 8.3 Init and actions

```text
POST /api/games/session/init
POST /api/games/session/flip
POST /api/games/session/tick
POST /api/games/session/tap
POST /api/games/session/finish
GET  /api/games/session/recover?sessionId=...
```

Request and response state stays as close as possible to React's existing
`/api/games/session/*` contract, except `walletAddress` is removed. The BFF
derives the participant and the Backend derives ownership from the session.

Every action includes an action sequence/idempotency value. Duplicate flips or
taps return the recorded outcome rather than applying twice. Memory Flip flushes
the ordered action queue before finish.

### 8.4 Finish response

```json
{
  "sessionId": "...",
  "accepted": true,
  "score": 750,
  "rewardMiles": 12,
  "rewardStable": 0,
  "completed": true,
  "elapsedMs": 43120,
  "antiAbuseFlags": [],
  "reward": {
    "mode": "offchain_ledger",
    "status": "completed",
    "deliveryId": "..."
  },
  "playsToday": 4,
  "playsRemaining": 1
}
```

For a verified wallet, reward mode is `onchain_mint` and status normally starts
as `pending`. A zero-Miles result has `reward.mode = "none"` and is still a
finalized accepted game result.

## 9. Daily play reservation

### 9.1 Time boundary

`play_date` is calculated in PostgreSQL with `Africa/Nairobi`, not in browser
JavaScript:

```sql
(now() at time zone 'Africa/Nairobi')::date
```

`nextResetAt` is the next Nairobi midnight rendered as an instant.

### 9.2 Reservation states

Create `hub_skill_game_play_reservations`:

```sql
create table hub_skill_game_play_reservations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  canonical_id uuid not null,
  hub_user_id uuid not null,
  game_type text not null check (game_type in ('rule_tap','memory_flip')),
  play_date date not null,
  status text not null check (status in ('reserved','started','finalized','voided')),
  idempotency_key text not null unique,
  reserved_at timestamptz not null default now(),
  started_at timestamptz,
  finalized_at timestamptz,
  expires_at timestamptz not null,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add an index on `(canonical_id, game_type, play_date, status)`.

### 9.3 Atomic reservation RPC

`reserve_hub_skill_game_play`:

1. resolves and locks the canonical participant;
2. acquires a participant/game/date advisory transaction lock;
3. voids expired `reserved` rows that never reached init;
4. counts `reserved`, `started`, and `finalized` rows for the date;
5. rejects when the count is five;
6. inserts one reservation and returns the count;
7. replays the same idempotency key without incrementing the count.

A reservation gets a short init window, for example two minutes. If init fails
because Backend state could not be created, it may be voided and the play
returned. Once init succeeds and status becomes `started`, abandonment,
refreshing, closing the tab, or a client network failure consumes the play.

This prevents deliberate disconnects from becoming unlimited free attempts.

## 10. Database compatibility model

Use root migration `061_hub_walletless_skill_games.sql` after the existing
canonical identity and verified-wallet migrations.

### 10.1 Server sessions

Extend `skill_game_server_sessions`:

```sql
alter table skill_game_server_sessions
  alter column wallet_address drop not null,
  add column if not exists canonical_id uuid,
  add column if not exists hub_user_id uuid,
  add column if not exists source_app text not null default 'react-app';
```

Replace the wallet-only ownership constraint with a constraint equivalent to:

```text
source_app = react-app -> wallet_address is present
source_app = hub-page  -> canonical_id and hub_user_id are present
```

Existing React rows backfill `source_app='react-app'`. Pass rows use
`source_app='hub-page'`, a canonical owner, and no gameplay wallet.

### 10.2 Finalized result log

Extend `skill_game_sessions` similarly:

```text
canonical_id
hub_user_id
source_app
reward_delivery_id
```

Make the legacy `wallet_address` nullable. Retain existing chain settlement
columns for React compatibility, but Pass finalization never writes a skill-game
settlement signature or `skill_game_settlement_jobs` row.

The table remains the authoritative accepted-result source for shared
leaderboards and sponsored-game evidence.

### 10.3 Idempotent game actions

Create a compact action receipt table for mutation retries:

```sql
create table skill_game_session_actions (
  session_id text not null references skill_game_server_sessions(session_id),
  action_id uuid not null,
  sequence_no integer not null,
  action_type text not null check (action_type in ('flip','tap')),
  input_hash text not null,
  outcome jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (session_id, action_id),
  unique (session_id, sequence_no)
);
```

The Backend locks the session, returns the stored outcome for a repeated action
ID, rejects reuse with a different input hash, applies each sequence once, and
persists the outcome with the state version update. This makes browser retries
safe without weakening the existing invalid-card, duplicate-target, or timing
rules.

### 10.4 Reward delivery

Create `skill_game_reward_deliveries`:

```sql
create table skill_game_reward_deliveries (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique references skill_game_sessions(session_id),
  canonical_id uuid not null,
  mode text not null check (mode in ('offchain_ledger','onchain_mint')),
  status text not null check (status in ('pending','processing','completed','failed')),
  points integer not null check (points > 0),
  destination_wallet text,
  idempotency_key text not null unique,
  ledger_entry_id uuid,
  mint_job_id uuid,
  external_ref text,
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode = 'offchain_ledger' and destination_wallet is null)
    or
    (mode = 'onchain_mint' and destination_wallet is not null)
  )
);
```

The idempotency key is:

```text
skill-game-reward:<session-id>
```

Add `skill_game_reward_delivery_id` to `minipoint_mint_jobs`, with an index for
non-null values. The payload kind is `hub_skill_game_reward` and includes only
audit information; the worker mints from top-level `user_address` and `points`.

## 11. Authoritative finalization and reward delivery

### 11.1 One transaction

After the pure Backend engine computes the result, call a service-role-only RPC
such as `finalize_hub_skill_game_session`. The RPC must:

1. lock the play reservation and server session;
2. verify they belong to the asserted canonical participant;
3. return the existing result if already finalized;
4. write the authoritative result and anti-abuse flags;
5. mark the reservation `finalized`;
6. if reward is zero or the result is rejected, create no delivery;
7. resolve the member's current cryptographically verified primary wallet;
8. reserve exactly one delivery;
9. atomically credit the ledger or enqueue the mint job;
10. return the persisted result and delivery state.

The RPC accepts score and reward only from the Backend service role. It is never
granted to `anon` or `authenticated`. The Backend must still validate that the
reward matches its own score table before calling the RPC.

### 11.2 Walletless delivery

When there is no verified wallet:

1. insert one `miles_ledger` credit with `canonical_id`, `direction='credit'`,
   `source_type='skill_game'`, `source_id=<delivery-id>`, and `on_chain=false`;
2. store the ledger row ID on the delivery;
3. mark the delivery completed in the same transaction.

A partial unique index for skill-game credit source/direction prevents a second
ledger insert even under concurrent finish calls.

### 11.3 Verified-wallet delivery

When there is a verified wallet:

1. snapshot its lowercase address on the delivery;
2. insert one `minipoint_mint_jobs` row with idempotency key
   `skill-game:<session-id>`;
3. set `reason='skill-game:<game-type>'`;
4. link `skill_game_reward_delivery_id`;
5. leave delivery status `pending`.

The existing Backend mint worker then handles batching, retries, blacklist
behavior, receipt confirmation, and terminal failure. No game contract is
called.

After a confirmed mint, the worker calls
`complete_skill_game_reward_delivery(delivery_id, tx_hash)`. On a terminal
pre-mint failure it calls `fail_skill_game_reward_delivery`. If the mint is
already confirmed but the completion mirror fails, it logs and reconciles from
completed jobs without reminting.

### 11.4 Wallet linking after reward

Delivery mode is immutable after reservation. A wallet linked after an
off-chain game credit joins the same canonical identity, so the balance remains
visible, but that historical delivery stays off-chain. Future finalized rounds
may use the verified wallet and mint through the worker.

## 12. Leaderboards

Retain React's Today/This week presentation, but remove wallet-only assumptions.

Each leaderboard row exposes a public `playerKey`, display name, score, reward,
and time. It never exposes email or Hub user ID.

Grouping key:

1. canonical ID when the session has one;
2. resolved canonical ID for a known React wallet when available;
3. otherwise a legacy normalized wallet key.

Only the best accepted score per player/game/scope counts. Pass determines “you”
from canonical ID. Display-name precedence is Hub profile name, React username,
then a neutral `Player ####` alias or shortened legacy wallet.

Pass v1 does not promise weekly voucher prizes. The UI must not show a merchant
prize tier unless that prize pipeline explicitly supports canonical walletless
ownership.

## 13. Sponsored-game partner quest

Update the canonical partner quest rules:

- `sponsored_game_played.requiresWallet = false` in Hub catalog;
- Hub evidence queries an accepted `skill_game_sessions` row owned by the
  member's canonical ID in the active campaign/week;
- verified wallet sessions remain a migration fallback;
- an accepted result qualifies even when its game score earned zero round
  Miles, because the quest action is playing an accepted sponsored session;
- the quest's own 25-Mile weekly reward remains separately idempotent through
  the canonical partner quest delivery registry.

The game reward and quest reward are distinct products and may both be earned.
Neither may cause the other to replay.

This section supersedes the current wallet-required sponsored-game statements
in `canonical-cross-app-partner-quest-spec.md` and
`merchant-shopping-quests-spec.md` once this feature launches.

## 14. Recovery and UI state

Use these user-visible states:

| State | UI |
|---|---|
| `status_loading` | Skeleton; Play disabled |
| `ready` | Free Play enabled; remaining starts shown |
| `starting` | “Starting round…” |
| `playing` | Existing shared game UI |
| `submitting` | “Checking your score…” |
| `reward_pending` | Score accepted; “Miles are being added” |
| `reward_completed` | “Reward added” |
| `no_reward` | Accepted score below threshold |
| `rejected` | Result rejected; no reward |
| `daily_cap_reached` | “5/5 played today · Come back tomorrow” |
| `service_unavailable` | Retryable service message; Play disabled |
| `reward_failed` | Score retained; support/retry message |

Refresh recovery uses `sessionId` only through the authenticated BFF. Recovery
returns reservation, engine, result, and reward states. It never takes a wallet
from the query string for Pass sessions.

If a finished request times out, the client calls recovery before attempting
finish again. Repeating finish returns the same persisted delivery.

## 15. Security and abuse controls

Required controls:

- authenticated Supabase user on every Pass BFF request;
- canonical identity binding on every Backend action;
- signed, short-lived service assertions;
- origin/CSRF checks on mutations;
- per-user and per-IP rate limits on start and actions;
- atomic five-play limit;
- server-created session IDs and seeds;
- optimistic-concurrency/version checks already used by the engines;
- ordered and idempotent action application;
- existing timing and impossible-speed checks;
- blacklist check before an on-chain reward job is enqueued;
- no fallback to mock/client-authoritative scoring in production;
- no reward when finalization dependencies are unavailable;
- structured audit records for cap denial, rejection, and delivery failure.

Free entry increases bot incentive. Rollout must monitor accounts per device/IP,
perfect-score rate, exact-timing flags, completion-time distribution, reward
Miles per canonical/day, and identity-merge clusters. Device/IP signals may
send a session to review but must not become a durable identity key.

## 16. Analytics and observability

Shared components emit transport-neutral callbacks. Each host maps them to its
own analytics implementation.

Minimum events:

```text
games_home_view
game_rules_view
game_start_requested
game_start_succeeded
game_start_denied_cap
game_started
game_finished
game_result_rejected
game_reward_reserved
game_reward_completed
game_reward_failed
game_play_again_tap
game_leaderboard_view
```

Properties include `gameType`, `sourceApp`, `playsRemaining`, score tier,
delivery mode/status, and anti-abuse flag names. Do not send email, canonical ID,
Hub user ID, full wallet, seed, or action timeline to analytics.

Health endpoints and dashboards expose:

- Web2 start/init/finish success and latency;
- active and expired reservations;
- starts per game/day;
- cap-denial rate;
- accepted/rejected/zero-reward results;
- ledger delivery count and value;
- mint delivery pending/processing/failed/stuck counts;
- finalized sessions without deliveries when reward is positive;
- deliveries without matching ledger entry or mint job;
- maximum daily reward exposure and actual issuance.

## 17. Migration and compatibility

1. Add migration `061_hub_walletless_skill_games.sql`.
2. Backfill existing game rows as `source_app='react-app'`.
3. Do not infer canonical ownership for historical wallets unless the existing
   canonical identity resolver can prove the link.
4. Deploy shared package extraction while React still uses its existing adapter.
5. Deploy Backend Web2 endpoints and finalization RPC support dark.
6. Deploy Backend mint-worker delivery completion/reconciliation.
7. Deploy Pass BFF and UI behind a rollout flag.
8. Enable internal users, then a percentage/allowlist.
9. Replace Rewards navigation only when health and payout paths are ready.
10. Keep `/rewards` redirect and the unused compatibility API during the
    observation window.

React contract-backed start and settlement tables are not migrated or replayed.
No historical game reward is reissued.

## 18. Test contract

### 18.1 Shared package

- both React and Pass compile against the same component exports;
- Memory Flip and Rule Tap interaction tests run once against a fake transport;
- free entry mode has no ticket/purchase/wallet copy;
- React ticket mode retains current behavior;
- scoring snapshots match Backend fixtures exactly.

### 18.2 Daily limit

- first through fifth starts succeed independently for each game;
- sixth start is rejected;
- concurrent fifth/sixth starts produce exactly one reservation;
- changing email or linking a wallet does not reset the count;
- two merged canonical identities collapse to one limit;
- an expired pre-init reservation is returned;
- an abandoned started session remains counted;
- Nairobi midnight resets the date, including UTC boundary tests.

### 18.3 Identity and API security

- walletless authenticated user can play both games;
- unauthenticated user cannot read personal status or mutate a session;
- one Hub user cannot act on another user's session ID;
- client-supplied canonical/user/wallet fields are ignored or rejected;
- invalid/expired/wrong-path service assertions fail;
- direct Backend calls without the service assertion fail;
- idempotency-key payload reuse conflicts.

### 18.4 Gameplay

- existing Backend engine suites remain green;
- Pass always uses server-authoritative init/actions/finish;
- ordered duplicate actions do not alter the score twice;
- finish adopts Backend score instead of provisional client score;
- blocking anti-abuse flags record zero reward;
- a below-threshold accepted score finalizes without a delivery.

### 18.5 Reward delivery

- walletless accepted reward inserts one ledger credit;
- verified-wallet accepted reward inserts one mint job and no ledger credit;
- concurrent finish calls create one delivery;
- finish retry returns the same delivery;
- worker completion updates the linked delivery;
- terminal pre-mint failure marks delivery failed;
- confirmed mint plus mirror failure reconciles without a second mint;
- wallet linking after ledger delivery does not create a mint;
- blacklisted verified wallet cannot receive an on-chain job and does not
  silently fall back to a walletless credit.

### 18.6 Cross-feature behavior

- Pass and React entries appear correctly in daily/weekly leaderboards;
- canonical duplicates contribute one best score;
- accepted walletless Pass session satisfies the active weekly sponsored-game
  quest;
- quest reward and game reward are independently idempotent;
- `/rewards` redirects to `/games`;
- desktop/mobile/PWA/home links all resolve to Games.

### 18.7 Production gates

- clean migration apply and idempotent reapply;
- Hub, React, shared package, and Backend typechecks/builds;
- full Hub and Backend tests;
- scoped React game regression suite;
- real PostgreSQL concurrency tests for play reservation and reward finalization;
- worker reconciliation test from completed mint jobs;
- browser smoke test on mobile viewport and installed-PWA safe areas.

## 19. Delivery slices

### Slice 1 — shared UI extraction

- create `@akiba/skill-games`;
- move shared components/core and update React imports;
- introduce the transport adapter boundary;
- prove zero React visual/scoring regression.

### Slice 2 — canonical Web2 game backend

- migration and reservation RPC;
- signed Pass-to-Backend identity;
- Web2 start/init/action/finish/recovery;
- server sessions owned by canonical identity;
- daily status and cap enforcement.

### Slice 3 — durable reward delivery

- atomic finalization RPC;
- ledger delivery;
- mint-job delivery through the existing worker;
- completion/failure/reconciliation hooks;
- balances and activity labels.

### Slice 4 — Pass product surface

- `/games` and both game pages;
- free-entry adaptations;
- canonical leaderboards;
- Rewards-to-Games navigation replacement and redirect;
- analytics and health.

### Slice 5 — quest and rollout

- walletless sponsored-game evidence;
- allowlist rollout;
- economics/fraud monitoring;
- progressive enablement.

## 20. Acceptance criteria

The feature is complete when:

- an authenticated Pass member with no wallet can play Memory Flip and Rule Tap;
- each game allows exactly five starts per Nairobi day and charges nothing;
- the rendered game experience comes from the same shared components used by
  React;
- Backend scoring and 6/9/12-Mile thresholds match React exactly;
- walletless rewards appear once in the member's ledger balance and activity;
- verified-wallet rewards go through the existing MiniPoints mint worker
  without a game-contract transaction;
- linking a wallet cannot duplicate a prior ledger reward or reset the play cap;
- a walletless accepted session can complete the sponsored-game quest;
- React's existing wallet game flow remains operational;
- the Pass Rewards page and navigation have been replaced by Games;
- concurrent start, finish, and worker tests prove cap and reward idempotency;
- operators can identify stuck sessions or reward deliveries without querying
  raw logs.
