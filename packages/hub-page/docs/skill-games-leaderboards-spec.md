# Skill game leaderboards and dormant prize distribution

**Packages:** `packages/skill-games`, `packages/hub-page`, `packages/react-app`, `packages/backend`, `supabase/migrations`
**Games:** Rule Tap and Memory Flip
**Status:** Proposed
**Purpose:** Implementation contract
**Supersedes:** Leaderboard decisions in §12 of `walletless-pass-skill-games-spec.md`. It deliberately does not enable, announce, or promise weekly prizes.

## 1. Decision

Akiba will have one score leaderboard for Rule Tap and Memory Flip. Members
compete under public `@usernames`, whether their accepted result was created in
Akiba Pass (Hub Page) or the React app.

The visible product at launch is standings only:

- each game has **Today** and **This week** standings;
- each player has one best accepted result per game and period;
- a member can see their own rank, including when it is outside the displayed
  top rows;
- neither app mentions prize pools, merchants, vouchers, prize zones, nor
  winner rewards.

The same release installs the durable, canonical-owner prize-distribution
facility needed for a future weekly voucher programme. It starts disabled. A
disabled or draft campaign cannot issue a voucher, enqueue a notification,
render prize copy, or change a member's standings.

This separates three concerns which must never be conflated:

1. **Standing:** an accepted score ranked within a defined time period.
2. **Prize eligibility:** a closed-week standing that passes a future campaign's
   rules and fraud/compliance checks.
3. **Prize delivery:** an idempotent voucher issuance to the winning canonical
   member's selected, immutable recipient.

## 2. Product rules

### 2.1 Scope and time

All leaderboard periods use `Africa/Nairobi`.

| Scope | Start | End | Current visible label |
|---|---|---|---|
| Daily | 00:00 EAT | next 00:00 EAT | Today |
| Weekly | Monday 00:00 EAT | following Monday 00:00 EAT | This week |

The current React endpoint uses UTC while Pass's partial query uses Nairobi
time. Both must be replaced; mixing those boundaries would let a player's play
cap and displayed daily standing reset at different times.

Only `accepted = true` results participate. Rejected, voided, unfinished, or
reward-delivery-failed results never participate. A zero-Miles accepted result
does participate: leaderboard score and round reward are separate products.

### 2.2 Ranking

For every `(player, game_type, scope)` only the best accepted result counts.
The deterministic ordering is:

1. higher `score`;
2. lower persisted `elapsed_ms`;
3. earlier `created_at`;
4. `session_id` ascending, solely as a final deterministic tie-breaker.

Ranks are ordinal (`1, 2, 3, 4…`), not dense. The selected best session
supplies the displayed score, earned Miles, elapsed time, and played-at time.

### 2.3 Participant identity

The ranking grouping key is resolved server-side in this order:

1. `skill_game_sessions.canonical_id` when present;
2. the canonical ID resolved from the session's verified wallet identity;
3. `wallet:<normalized-wallet>` for an unlinked legacy React session.

The browser never sends a player key, canonical ID, wallet, score, rank, or
period boundary for ranking purposes. The user-facing `playerKey` is an opaque
stable identifier, not a canonical UUID, Hub user ID, email, or raw wallet.

When canonical identities merge, every canonical-owned skill-game record must
move to the surviving canonical in the same locked transaction. At minimum this
includes `skill_game_sessions`, `skill_game_server_sessions`,
`hub_skill_game_play_reservations`, and any leaderboard prize delivery rows.
Legacy wallet rows remain dynamically resolvable through `identity_links`.

### 2.4 Public usernames

Leaderboard names are public `@usernames`; full names and email addresses are
never returned or rendered.

Create a canonical profile table:

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE leaderboard_profiles (
  canonical_id       uuid PRIMARY KEY,
  username           citext NOT NULL UNIQUE,
  username_normalized text GENERATED ALWAYS AS (lower(username::text)) STORED,
  changed_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (username::text ~ '^[a-z0-9_]{3,20}$')
);
```

`citext` and the check intentionally make usernames lowercase ASCII. The
server rejects reserved names, profanity/reserved-brand matches, and names that
belong to another canonical. Changes are allowed once every 30 days, are
audited, and are rate-limited. A Hub member claims or edits their username from
Profile; the React app uses the same API rather than a separate namespace.

Before a canonical member has claimed a username, the server may use a linked
legacy React `users.username`. Otherwise it returns a neutral alias such as
`Player 7K3M`. It must not fall back to `full_name` or email. Claiming a
username is optional for playing games and earning per-round Miles.

## 3. Required invariants

1. The same real member cannot occupy two positions because they played from
   Hub and React after their identities are linked.
2. A client cannot influence the participant key, selected best session, rank,
   score, period, elapsed time, or prize recipient.
3. A leaderboard response exposes no email, Hub user ID, canonical UUID, raw
   wallet, anti-abuse flag, or internal reward-delivery data.
4. Results are visible once accepted; an on-chain or off-chain round reward
   may still be pending without hiding the result.
5. A failed leaderboard read never changes, deletes, or replays a game result.
6. A canonical merge preserves historical scores and cannot duplicate a member
   in a ranking.
7. Each `(closed-week, game, rank)` can produce at most one prize delivery.
8. A prize delivery is owned by a canonical member and uses one immutable
   recipient selected by the server at reservation time.
9. A disabled, draft, dry-run, cancelled, or unapproved prize campaign issues
   nothing, creates no user-visible prize, and sends no notification.
10. A member does not forfeit a future prize by failing to open either app.
11. Prize issuance is retriable and idempotent; a completed voucher is never
   issued or credited again.
12. Existing React voucher programmes and their inventory caps remain the
   authority for voucher stock. A leaderboard campaign cannot bypass them.

## 4. Data model

### 4.1 Authoritative results

Add immutable ranking fields to `skill_game_sessions`:

```sql
ALTER TABLE skill_game_sessions
  ADD COLUMN IF NOT EXISTS elapsed_ms integer,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

ALTER TABLE skill_game_sessions
  ADD CONSTRAINT skill_game_sessions_elapsed_ms_valid
  CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0);

CREATE INDEX IF NOT EXISTS idx_skill_game_sessions_leaderboard
  ON skill_game_sessions (game_type, created_at, score DESC, elapsed_ms ASC)
  WHERE accepted = true;
```

Both finalization paths persist the server-authoritative elapsed time:

- `packages/backend/src/games/web2Routes.ts` passes `final.elapsedMs` into the
  Hub finalization RPC;
- React's authoritative finalizer persists the verified elapsed time with its
  `skill_game_sessions` upsert.

The finalization RPC accepts and persists `p_elapsed_ms`. It must return the
persisted row on retry rather than recomputing a different time. Backfilled
legacy rows may retain `NULL`; they sort after rows with a known elapsed time
when score ties, then use `created_at`.

### 4.2 Canonical leaderboard query

Create a server-only SQL function, for example:

```text
get_skill_game_leaderboard(
  p_game_type text,
  p_scope text,                 -- daily | weekly
  p_viewer_canonical_id uuid,
  p_limit integer default 20
) -> entries, my_best, period_start, period_end
```

It calculates the EAT period bounds itself; callers cannot supply timestamps.
It resolves the participant key in §2.3, selects one result per player with
`row_number()`, applies the ordering in §2.2, and calculates the viewer's rank
over the entire result set before applying `p_limit`.

The public shape is the existing shared-package contract, completed as follows:

```ts
type LeaderboardEntry = {
  rank: number;
  playerKey: string;       // opaque; safe to render only as a React key
  displayName: string;     // "@amina" or "Player 7K3M"
  score: number;
  rewardMiles: number;
  elapsedMs: number | null;
  playedAt: string;
  isYou: boolean;
};

type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  myBest: LeaderboardEntry | null;
  period: { scope: "daily" | "weekly"; startsAt: string; endsAt: string };
};
```

The function is executable only by `service_role`. Hub and React call it from
their own authenticated BFFs after resolving the viewer's canonical identity.
React must stop accepting `wallet` as a client-supplied viewer selector.

The current React endpoint must be removed or rewritten in the same deploy as
the Hub route: it calls `.toLowerCase()` on every `wallet_address` and will
fail once it sees a walletless Hub result.

### 4.3 Username mutation and read access

Provide a service-only `set_leaderboard_username(canonical_id, username)` RPC
that locks the canonical profile, validates availability and cooldown, records
an audit entry, and upserts the profile. Client routes authenticate the member
and resolve the canonical ID server-side. No direct table mutation is granted
to `authenticated` or `anon` roles.

The leaderboard read function joins `leaderboard_profiles` first, then the
linked legacy React username, then creates the neutral alias. It must never
read or return a profile's email or full name.

### 4.4 Dormant prize campaigns

Reuse the existing `game_weekly_campaigns` concept and the
`weekly_leaderboard_challenge` voucher-program channel rather than creating a
second merchant inventory system. Normalize the currently ungoverned React SQL
into a numbered Supabase migration and add explicit state:

```sql
ALTER TABLE game_weekly_campaigns
  ADD COLUMN IF NOT EXISTS prize_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'hidden',
  ADD COLUMN IF NOT EXISTS settlement_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT game_weekly_campaigns_prize_state
    CHECK (prize_state IN ('draft', 'armed', 'settling', 'settled', 'cancelled')),
  ADD CONSTRAINT game_weekly_campaigns_publication_state
    CHECK (publication_state IN ('hidden', 'announced'));
```

At launch every campaign is `draft` and `hidden`. The public leaderboard API
does not select campaign, tier, merchant, or prize columns. Existing prize
banners, `LeaderboardWinSheet`, prize inbox routes, and notifications remain
out of Hub Page scope and must not be mounted there.

Each tier references a valid `voucher_program_channel_allocations` row whose
channel is `weekly_leaderboard_challenge`. It snapshots the voucher template,
merchant, expiry, burn policy, and programme allocation at the moment the
week is armed. The settlement job validates that the programme and allocation
are still active and have capacity before it reserves a delivery.

### 4.5 Canonical prize deliveries

The address-only `leaderboard_prize_events` and
`issue_leaderboard_prize(...)` implementation cannot award a walletless Hub
winner. Replace it with a canonical delivery registry and retain the legacy
event table only as a compatibility/audit projection.

```sql
CREATE TABLE skill_game_leaderboard_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid NOT NULL REFERENCES game_weekly_campaigns(id),
  game_type             text NOT NULL CHECK (game_type IN ('rule_tap', 'memory_flip')),
  week                  text NOT NULL,
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  status                text NOT NULL CHECK (status IN ('dry_run', 'settling', 'settled', 'failed', 'cancelled')),
  standings_snapshot    jsonb NOT NULL,
  snapshot_hash         text NOT NULL,
  started_at            timestamptz,
  completed_at          timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, game_type, week)
);

CREATE TABLE skill_game_leaderboard_prize_deliveries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id         uuid NOT NULL REFERENCES skill_game_leaderboard_settlements(id),
  canonical_id          uuid NOT NULL,
  rank                  integer NOT NULL CHECK (rank > 0),
  score                 integer NOT NULL,
  winning_session_id    text NOT NULL REFERENCES skill_game_sessions(session_id),
  recipient_kind        text NOT NULL CHECK (recipient_kind IN ('hub_user', 'wallet')),
  hub_user_id           uuid REFERENCES auth.users(id),
  destination_wallet    text,
  voucher_id            uuid REFERENCES issued_vouchers(id),
  status                text NOT NULL CHECK (status IN ('reserved', 'issued', 'failed', 'voided')),
  idempotency_key       text NOT NULL UNIQUE,
  attempts              integer NOT NULL DEFAULT 0,
  last_error            text,
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (recipient_kind = 'hub_user' AND hub_user_id IS NOT NULL AND destination_wallet IS NULL)
    OR
    (recipient_kind = 'wallet' AND destination_wallet IS NOT NULL AND hub_user_id IS NULL)
  ),
  UNIQUE (settlement_id, rank),
  UNIQUE (settlement_id, canonical_id)
);
```

`UNIQUE (settlement_id, canonical_id)` means a player may win once per game
settlement. They may still win independently in both Rule Tap and Memory Flip.
If a later rank belongs to a canonical already selected at a higher rank, the
settler advances to the next eligible player and preserves the skip reason in
the snapshot/audit data.

The recipient is selected at reservation time, never by a client:

1. a winning Hub session with `hub_user_id` issues a Hub-owned voucher;
2. otherwise a verified wallet-backed winner issues a wallet-owned voucher;
3. if neither permitted recipient exists, delivery is `failed` for manual
   review and no replacement winner is silently chosen.

The issued voucher records `hub_user_id` or `user_address`, its programme and
campaign source, and a source reference derived from the delivery ID. The
delivery registry is the idempotency boundary; do not use just
`game:week:rank`, which is unsafe for campaign corrections or reruns.

### 4.6 Prize gating and activation

Prize infrastructure has two independent server-only gates, both false by
default:

```text
LEADERBOARD_PRIZE_ISSUANCE_ENABLED=false
LEADERBOARD_PRIZE_PUBLICATION_ENABLED=false
```

Issuance requires all of the following:

1. `LEADERBOARD_PRIZE_ISSUANCE_ENABLED=true`;
2. the campaign is `armed` before its EAT week begins;
3. the campaign's allocation and template validate at arm time and settlement
   time;
4. an authorized operator has approved the campaign in the audit log;
5. the closed-week settlement has no unresolved integrity or abuse review;
6. the winning result passes the campaign's documented eligibility rules.

Publication requires `LEADERBOARD_PRIZE_PUBLICATION_ENABLED=true` and an
`announced` campaign. Publication controls copy and notifications only; it
does not enable issuance. In this release, do not set this flag or state.

With issuance disabled, the weekly worker may run only in `dry_run`. It writes
an internal immutable candidate snapshot and metrics, creates no voucher,
delivery, event, push, email, or user-visible record.

## 5. APIs and UI

### 5.1 Leaderboard BFF

Both applications provide:

```text
GET /api/games/leaderboard?gameType=rule_tap&period=daily|weekly
```

The response is §4.2. The Hub route requires the Supabase session. The React
route requires the existing authenticated wallet session, resolves a canonical
identity on the server, and never trusts a wallet query parameter.

Requests use `Cache-Control: no-store`; clients refresh on first display,
after a result is accepted, when switching scopes, and on explicit retry. A
poll interval shorter than 60 seconds is not required for launch.

### 5.2 Shared card

Add a host-neutral `LeaderboardCard` to `@akiba/skill-games/components`. It
receives data/loader props and `viewerKey`; it does not import Web3, Supabase,
Next routing, PostHog, a wallet, or a private app component.

It renders:

- header: **Leaderboard**;
- tabs: **Today** and **This week**;
- up to five ranked rows, using `@username` or the neutral alias;
- a highlighted `You` row; when the viewer is outside the first five, show a
  pinned row below the list with their exact rank;
- score and, where present, elapsed time;
- explicit empty, loading, and retryable-error states;
- no merchant, voucher, prize, sponsor, countdown, prize-zone, or reward
  promotion content.

Mount the card on both Hub game pages, matching React's in-game placement.
Add a dedicated Hub route such as `/games/leaderboard?gameType=rule_tap` and
point `GameResultSheet`'s existing **View standings** CTA to it. The Hub games
home can show a compact personal rank link, but it must not duplicate the full
table or suggest prizes.

### 5.3 Username UI

Add a Profile section that lets an authenticated user claim or change their
`@username`. It explains that the name is public on skill-game leaderboards,
shows validation before submit, and offers no default based on their real name
or email. A missing username never blocks game play; its leaderboard row uses
the safe alias.

### 5.4 Explicitly absent at launch

Do not ship any of the following in Hub Page or React as part of this spec:

- prize or merchant copy, tiers, countdowns, campaign banners, or prize zones;
- a prize landing page, winner reveal, voucher-wallet badge, prize inbox, or
  prize-related push/email/web notification;
- a public campaign endpoint or client-readable prize flag;
- automatic issuance, expiry burn, or backfill of past standings;
- user-facing “qualifying”, “winner”, or “prize pending” states.

The only launch analytics are leaderboard view, scope switch, load result,
username claim/update, and standings CTA events. They contain game type and
scope only—never username, canonical ID, email, or wallet.

## 6. Settlement design for a future enabled campaign

This section specifies dormant behaviour only. It is not an authorization to
turn it on.

At Monday 00:10 EAT, after a configurable quiet period for in-flight finalizers,
the worker locks one campaign/game/week settlement row and:

1. obtains the same closed-week ranking query used by the UI, with fixed
   historical EAT bounds;
2. records an immutable snapshot of candidate player keys, selected sessions,
   scores, rank order, configuration version, and hash;
3. filters results using documented campaign eligibility and blocking abuse
   review rules; it records every skip reason;
4. reserves canonical prize deliveries in rank order under a transaction;
5. issues each reserved voucher through the existing programme allocation
   path, assigning its immutable Hub or wallet owner;
6. records the voucher ID and completion state on the delivery and writes a
   compatibility audit event;
7. retries only `reserved`/`failed` deliveries using their delivery-specific
   idempotency key; it never recomputes or reshuffles a settled snapshot.

The job is safe to re-run. It must stop and surface an operational incident if
the campaign, inventory, recipient, or abuse checks are ambiguous. It must not
fall through to a lower-ranked participant unless the snapshot's explicit
eligibility policy permits that skip.

## 7. Migration and rollout sequence

1. Add `elapsed_ms`, `finalized_at`, leaderboard indexes, and canonical-merge
   updates. Deploy finalizers that persist elapsed time before relying on it in
   tie-breaks.
2. Add canonical username storage, server mutation, alias fallback, and Profile
   UI. Backfill nothing from full names or email.
3. Add the server-only leaderboard function and fixtures. Rewrite the React
   endpoint and add the Hub endpoint against it in the same release.
4. Extract the shared card, render it on both game surfaces, and update result
   CTAs. Enable only the standings feature behind the existing games rollout.
5. Migrate/normalize the dormant campaign and canonical prize-delivery schema.
   Deploy settlement code in dry-run-only mode with both prize flags false.
6. Observe two complete weekly dry runs. Reconcile snapshots with the visible
   standings and verify that zero vouchers, prize events, notifications, and
   user-facing prize copy were produced.
7. A later, separately approved launch may arm a campaign, enable issuance,
   then separately enable publication. It requires prize terms, fraud review,
   voucher inventory review, support runbook, legal/compliance review, and
   rollback ownership.

## 8. Acceptance criteria

### Standings

- A Hub-only player and a React-only player appear in the same game and period
  standing.
- A linked Hub/React member occupies one row with their best result across both
  apps.
- An unlinked legacy wallet player remains one neutral public row and joins the
  canonical row after verified linking.
- A canonical merge does not leave duplicate historical rows.
- Daily and weekly boundaries switch at the specified EAT times in both apps.
- A new accepted score appears after refresh even while its round reward is
  pending.
- The viewer sees their exact rank outside the top five.
- No response, UI, analytics event, log, or browser storage exposes email,
  canonical UUID, full name, raw wallet, or anti-abuse flags.
- A walletless Hub result does not crash the React leaderboard endpoint.

### Usernames

- A member can claim an available `@username`; a duplicate, invalid, reserved,
  or cooldown-violating request is rejected server-side.
- A username is global across Hub and React after canonical identity resolution.
- A member without a username can play and sees only a neutral alias publicly.
- Full name and email are never selected as a fallback display name.

### Dormant prizes

- With both prize flags false, a scheduled run creates at most a dry-run
  settlement snapshot and never creates an issued voucher, prize delivery,
  notification, or public prize data.
- A draft, hidden, or unapproved campaign cannot issue even if a worker is
  invoked manually.
- When enabled in a controlled test, retrying settlement cannot create a second
  voucher for the same canonical delivery.
- A walletless Hub winner receives a Hub-owned voucher in the controlled test;
  a wallet winner receives a wallet-owned voucher; neither recipient can be
  chosen by the client.
- A failed or ambiguous delivery is auditable and recoverable without silently
  awarding a different participant.

## 9. Open activation decisions

These are intentionally deferred and must be decided before any campaign is
armed:

- prize type and voucher tier count per game;
- geographic, age, employee, and fraud eligibility policy;
- whether one canonical can win across both games in the same week;
- voucher expiry and optional Miles-burn policy;
- notification, announcement, and winner-reveal experience;
- operator approval roles, on-call owner, and incident/rollback process.
