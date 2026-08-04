# Canonical cross-app partner quest completion

**Packages:** `packages/react-app`, `packages/hub-page`  
**Catalog:** `api_partner_quests`  
**Status:** Proposed  
**Purpose:** Implementation contract  
**Supersedes:** The completion, identity, and reward-delivery decisions in `merchant-shopping-quests-spec.md`

## 1. Decision

React and Hub will use one canonical completion registry for the five merchant
partner quests represented in `api_partner_quests`.

The change will preserve the parts of React that already work:

- React continues to verify wallet actions with its existing first-party
  records.
- Wallet rewards continue through `minipoint_mint_jobs` and are considered
  delivered only after the mint worker succeeds.
- `partner_engagements` and `partner_quest_weekly_claims` remain compatibility
  records during migration.

Hub adds an account-first path:

- an authenticated Hub user is a quest participant even without a wallet;
- Hub verifies non-wallet actions from Hub-owned domain records;
- a walletless reward is credited once to `miles_ledger`;
- linking a verified wallet later joins the existing participant instead of
  creating another completion or minting the same reward again.

Both apps read completion from the canonical registry. They may use different
first-party evidence to establish eligibility, but they must not maintain
independent definitions of whether a quest has already been completed.

## 2. Required invariants

1. A participant can receive at most one reward for a one-time quest.
2. A participant can receive at most one reward per ISO week for a weekly
   quest.
3. Completion follows the participant across Hub account, email, and verified
   wallet identities.
4. An unverified email or client-supplied wallet never joins identities.
5. A walletless completion is not minted again when a wallet is linked.
6. A failed or pending on-chain mint is not reported as reward-complete.
7. Retrying either app is idempotent, including concurrent claims in both apps.
8. Existing successful React completions remain successful after cutover.
9. A Platform outage must not turn a known completion back into `verifying`.
10. `verifying` is used only for a real, observable asynchronous verification
    job—not for missing configuration, an ID mismatch, or an empty response.

## 3. Scope

This specification covers these launch quests:

| Canonical key | React `partner_quests.id` | `api_partner_quests.id` | Scope |
|---|---|---|---|
| `pass_activated` | `f647e695-7009-455a-a138-b3ee50de73f2` | `216cd2c5-74c9-4e79-80ba-612ecaff4aaf` | Lifetime |
| `deal_viewed` | `4eaf67c7-03f5-4c24-a63d-2c1c8ab765d1` | `83f26878-c33a-4c40-b0d0-6f7bfdf33355` | Lifetime |
| `sponsored_game_played` | `c94ded62-19e8-4d04-910b-56e0dd1bec34` | `7161b80b-ba30-404e-aba3-3faa24f763c7` | ISO week |
| `profile_country_set` | `47bc3625-f2f6-4b0f-ae72-b8bfde85bd31` | `a2a2cce0-6607-4648-a7fc-698d0ee5a489` | Lifetime |
| `voucher_redeemed` | `2ad4bc13-d3b9-41b6-b3ef-d3a1ebb7b2aa` | `2d3b9bb5-e3f2-49cf-8ca9-7369a2e03ff0` | Lifetime |

The UUID pairs must be seeded as data, not duplicated as unrelated constants
in the two applications. `quest_key` is the stable product identifier; either
UUID is an adapter identifier.

Out of scope:

- converting old daily quests or unrelated partner quests;
- automatically bridging off-chain Miles on-chain;
- changing React's wallet authentication model;
- accepting arbitrary client-submitted proof;
- making email alone a wallet ownership proof.

## 4. Terminology and state boundaries

These concepts must remain separate:

- **Evidence:** a first-party record proving that an action occurred.
- **Eligible:** current evidence satisfies the quest rule.
- **Completion:** the eligible action and scope have been accepted once for a
  canonical participant.
- **Reward delivery:** the corresponding Miles credit or on-chain mint.

The shared registry is authoritative for completion and reward state. Existing
React and Hub domain tables remain authoritative for evidence.

## 5. Canonical identity

### 5.1 Participant key

Use the existing canonical identity UUID (`canonical_id`) as the participant
key. Add a stable Hub-account binding so identity does not depend on a mutable
email address:

```sql
create table hub_user_canonicals (
  hub_user_id uuid primary key,
  canonical_id uuid not null unique,
  created_at timestamptz not null default now()
);
```

`identity_links` remains the verified alias set for email and wallet
identities. A React-only wallet receives a canonical identity on first server
resolution. A Hub account receives one on first authenticated resolution.

### 5.2 Trusted identities

The following inputs are trusted only through these paths:

| Identity | Required proof |
|---|---|
| Hub user | Supabase server session and `auth.users.id` |
| Hub email | Email from the authenticated Supabase user, preferably verified |
| Hub-linked wallet | Existing verified wallet-link flow |
| React wallet | React's authenticated wallet session/signature |

React profile email, query-string addresses, request-body addresses, and
browser local storage are never identity-link authorities.

### 5.3 Wallet linking and canonical merge

When a Hub user links a wallet:

1. Verify wallet control using the existing wallet-link flow.
2. Resolve the Hub user's canonical and the wallet's canonical in one locked
   transaction.
3. If only one exists, attach the missing identity to it.
4. If both exist and differ, merge them before returning success.
5. Move identity links and completions to the surviving canonical.
6. Collapse duplicate `(quest, scope)` completions without creating a reward.
7. Preserve every existing ledger entry, mint job, transaction hash, and audit
   reference.

The Hub-account canonical should survive a merge because it is anchored to the
stable authenticated account. For duplicate delivery rows, state precedence is
`completed` over `pending` over `failed`. Conflicting completed delivery modes
are flagged for manual review but never replayed automatically.

The merge and a concurrent claim must serialize on both canonical IDs. A
partial merge is not acceptable.

## 6. Shared data model

Names below are normative unless an existing Platform table already provides
the same constraints.

### 6.1 Catalog bindings

```sql
create table quest_catalog_bindings (
  quest_key text primary key,
  api_partner_quest_id uuid not null unique,
  react_partner_quest_id uuid not null unique,
  frequency text not null check (frequency in ('once', 'weekly')),
  base_points integer not null check (base_points > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The service that owns `api_partner_quests` validates the API-side foreign key.
The React migration validates the React-side row. Deployment fails closed if
any binding is missing or points to a differently configured reward.

### 6.2 Canonical completions

```sql
create table api_partner_quest_completions (
  id uuid primary key default gen_random_uuid(),
  canonical_id uuid not null,
  api_partner_quest_id uuid not null references api_partner_quests(id),
  quest_key text not null references quest_catalog_bindings(quest_key),
  scope_key text not null,
  verification_source text not null,
  proof_ref text not null,
  claimed_from text not null check (claimed_from in ('react-app', 'hub-page', 'backfill')),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (canonical_id, api_partner_quest_id, scope_key)
);
```

`scope_key` is `lifetime` for one-time quests and the shared `YYYY-Www` ISO
week helper output for the weekly quest. `proof_ref` identifies a server-side
record; it is not opaque proof supplied by the browser.

### 6.3 Reward deliveries

```sql
create table api_partner_quest_reward_deliveries (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null unique
    references api_partner_quest_completions(id),
  mode text not null check (mode in ('onchain_mint', 'offchain_ledger')),
  status text not null check (status in ('pending', 'processing', 'completed', 'failed')),
  base_points integer not null,
  awarded_points integer not null,
  destination_wallet text,
  idempotency_key text not null unique,
  external_ref text,
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

The participant-scoped idempotency key is:

```text
partner-quest:<canonical-id>:<quest-key>:<scope-key>
```

Do not use a wallet address as the cross-app idempotency boundary. The legacy
React mint job may keep its current wallet key, but it must be linked to the
canonical delivery and cannot be created unless the canonical reservation
succeeds.

### 6.4 Access control

These tables are server-only. No public insert/update policy is permitted.
Mutation happens through security-definer RPCs or an authenticated internal
service with explicit caller authorization. User-facing APIs return only the
current participant's catalog projection.

## 7. Evidence and verification

The product rule is shared, while each app may contribute trusted evidence:

| Quest | React evidence | Hub evidence | Walletless? |
|---|---|---|---|
| Pass | `merchant_quest_action_proofs` with `pass_onboarding_opened` | `hub_user_passes` owned by `hub_user_id` | Yes |
| Deal | `merchant_quest_action_proofs` with `deal_opened` | `hub_quest_action_proofs` for a server-validated active offer | Yes |
| Sponsored game | Accepted `skill_game_sessions` row in the active campaign/week | Same wallet-owned game session | No; the action inherently uses a wallet |
| Country | `users.country` for the authenticated wallet | `hub_user_profiles.country` for the authenticated Hub user | Yes |
| Voucher | Redeemed `issued_vouchers` owned by wallet | Redeemed `issued_vouchers` owned by `hub_user_id` or a verified linked wallet | Yes |

Verification is always performed server-side immediately before reserving a
completion. A local evidence row can make a quest `eligible`; it does not by
itself credit Miles.

For shared domain records, either app may recognize evidence created by the
other after canonical identity resolution. The required cross-app guarantee,
however, begins at canonical completion: once rewarded or queued in one app,
the other app must show the same completion/reward state.

## 8. Claim and delivery flows

### 8.1 Common reservation

Both claim endpoints call one operation, conceptually:

```ts
reservePartnerQuestClaim({
  canonicalId,
  questKey,
  scopeKey,
  verificationSource,
  proofRef,
  claimedFrom,
  deliveryMode,
  destinationWallet?,
});
```

The operation:

1. resolves the binding and reward configuration;
2. revalidates the trusted proof;
3. locks `(canonical_id, api_partner_quest_id, scope_key)`;
4. returns the existing completion/delivery if already reserved;
5. otherwise inserts one completion and one delivery atomically.

Duplicate requests return the existing state with HTTP `200`; they are not a
new reward and should not surface as an alarming client error.

### 8.2 React wallet claim

1. Keep React eligibility, stable-hold, blacklist, attestation, and vault-boost
   checks unchanged.
2. Resolve the authenticated wallet to `canonical_id`.
3. Reserve the canonical claim with `mode = onchain_mint`.
4. In the same database transaction, create or associate the existing
   `minipoint_mint_jobs` row.
5. Return `reward_pending` while the job is pending or processing.
6. After a successful mint, the worker writes the existing
   `partner_engagements` or `partner_quest_weekly_claims` compatibility row and
   marks the canonical delivery `completed` with its transaction hash.
7. A terminal worker failure marks delivery `failed`; a retry reuses the same
   completion and delivery.

This adds a reservation and mirror around the working React path; it does not
replace React's verifier or mint worker.

### 8.3 Hub claim with a verified wallet

Hub uses the same `onchain_mint` reservation and React mint pipeline. It may
verify the action using Hub evidence, but must enqueue the same payload shape
and completion linkage as React. The result becomes visible in React
immediately as `reward_pending`, then `completed` after mint success.

### 8.4 Hub claim without a wallet

For the four walletless-capable quests:

1. Resolve the authenticated `hub_user_id` to its canonical.
2. Verify the Hub-owned evidence.
3. Reserve with `mode = offchain_ledger`.
4. In the same transaction, insert one `miles_ledger` credit using the
   completion ID as `source_id` and mark the delivery `completed`.
5. Return the refreshed canonical balance and `completed` status.

If the ledger insert fails, the transaction rolls back. The UI may show a
retryable service error, but it must not show `completed`.

Walletless members receive the catalog's base points. Wallet-only React vault
boosts remain available to wallets that satisfy React's existing rule. The
awarded amount is frozen on the delivery; linking a wallet later does not add
a retroactive boost.

### 8.5 Linking a wallet after a walletless reward

After identity merge, React finds the existing canonical completion and shows
it as complete. It does not create a mint job. The reward stays in the
off-chain ledger until the member uses an explicit future bridge feature or a
ledger-aware spend flow.

This is the central anti-duplication rule: identity linking changes who can see
the completion, not how an already delivered reward was paid.

## 9. Read contracts and UI states

Both apps should consume one server-side status projection:

```ts
type PartnerQuestState =
  | "needs_action"
  | "wallet_required"
  | "eligible"
  | "verifying"
  | "reward_pending"
  | "completed"
  | "reward_failed"
  | "service_unavailable";

type PartnerQuestStatus = {
  questKey: string;
  apiPartnerQuestId: string;
  localQuestId: string | null;
  scopeKey: string;
  state: PartnerQuestState;
  basePoints: number;
  awardedPoints: number | null;
  deliveryMode: "onchain_mint" | "offchain_ledger" | null;
  transactionHash: string | null;
  reason?: string;
};
```

Resolution precedence is:

1. canonical completion plus delivery state;
2. legacy successful React completion during migration;
3. active mint job during migration;
4. current server-side evidence;
5. wallet requirement only when the action inherently requires a wallet;
6. `needs_action`.

Missing catalog bindings, database failures, and dependency outages return
`service_unavailable`; they must not produce an endless `verifying` state.
`verifying` requires a concrete verification/outbox job ID and a bounded retry
policy. `reward_pending` is used for a concrete mint/ledger delivery.

Recommended endpoints:

- Hub: `GET /api/quests/status`, `POST /api/quests/claim`
- React: retain current endpoints, but have eligibility/status and claim use
  the shared resolver/reservation internally
- Internal worker: `POST /internal/partner-quests/deliveries/:id/complete` or
  an equivalent database RPC

Every status response is authenticated, private, and `no-store`.

## 10. Balance harmony

A shared completion with two possible delivery rails requires both apps to
show the same canonical balance composition:

```text
total Miles = unbridged off-chain ledger balance + on-chain MiniPoints balance
```

Hub already computes this composition through `identity_links` and
`miles_ledger`. Before walletless completion is generally available, React
must read the same canonical off-chain component for its authenticated wallet
and present the total consistently. APIs should return the two components as
well as the total so a spend flow can state which rail it supports.

This does not authorize automatic minting or bridging. It prevents the member
from seeing a completed 50-Mile quest in React while React displays a balance
that is 50 Miles lower with no explanation.

## 11. Migration and cutover

### Phase 0 — catalog validation

- Seed the five binding rows.
- Validate quest frequency and base reward on both sides.
- Add a readiness check that fails if a binding or referenced row is missing.
- Use one shared ISO-week utility or conformance tests with identical vectors.

### Phase 1 — schema and identity resolution

- Create Hub-account canonical bindings, canonical completions, and delivery
  tables.
- Implement canonical resolution and transactional merge.
- Add server-only read and reservation APIs.

### Phase 2 — backfill without rewards

Backfill canonical completions from:

- one-time `partner_engagements` rows whose reward mint succeeded;
- weekly `partner_quest_weekly_claims` rows backed by a successful job;
- completed `minipoint_mint_jobs` only when their partner-quest payload can be
  mapped unambiguously.

Use the historical awarded points and transaction hash. Backfill inserts
`mode = onchain_mint`, `status = completed`, and `claimed_from = backfill`.
It must never enqueue a job, mint, or insert a ledger credit.

Unsuccessful and ambiguous legacy records go to a reconciliation report, not
the completion table.

### Phase 3 — React mirror and dual read

- Update the React worker to finalize canonical delivery on mint success.
- Update React claim to reserve canonically before enqueuing.
- Read canonical first and legacy state second.
- Reconcile canonical and legacy successful counts by quest and ISO week.

### Phase 4 — Hub cutover

- Replace Platform-per-identity completion polling in Hub with the canonical
  status projection.
- Enable Hub wallet claims through the shared mint reservation.
- Enable walletless ledger claims for an internal allowlist.
- Verify Hub-to-React and React-to-Hub state propagation.

### Phase 5 — canonical authority

- Expand walletless rollout only after React shows the off-chain balance
  component.
- Remove legacy fallback after at least one weekly boundary and a clean
  reconciliation window.
- Keep compatibility writes until every downstream history/report consumer is
  migrated.

Rollback disables new Hub claims but leaves the canonical read and completed
records intact. Never delete completions as a rollback mechanism.

## 12. Failure and retry policy

| Failure | Required behavior |
|---|---|
| Proof query fails | `service_unavailable`; no reservation |
| Duplicate/concurrent claim | Return existing delivery state; no second reward |
| Mint pending | `reward_pending` with job reference |
| Mint failed | `reward_failed`; retry same delivery/job |
| Ledger credit fails | Roll back completion and delivery transaction |
| Canonical merge conflicts | Lock/retry; do not choose an identity client-side |
| Catalog ID missing/mismatched | Readiness failure and `service_unavailable` |
| Status dependency unavailable | Preserve known canonical completion; degrade only unknown states |
| Worker succeeds but finalization times out | Reconcile by transaction/job reference; never mint again |

## 13. Security requirements

- Derive the Hub user and React wallet from server-authenticated sessions.
- Normalize wallets to lowercase before identity lookup and uniqueness checks.
- Normalize verified emails consistently, but never use a request-body email as
  authorization.
- Re-run eligibility on claim; do not trust a UI status response.
- Keep reward amount, quest mapping, scope, and delivery mode server-owned.
- Require wallet control before adding a wallet identity.
- Record actor app, canonical ID, proof reference, completion ID, delivery ID,
  and correlation ID in audit events.
- Rate-limit claim, identity-link, and merge endpoints.
- Do not expose another participant's completion through direct table reads.

## 14. Observability

Track, without logging raw email addresses:

- claims and completions by app, quest, scope, and delivery mode;
- duplicate reservations prevented;
- pending and failed delivery age;
- canonical/legacy reconciliation differences;
- identity merges and duplicate completions collapsed;
- walletless completions later viewed from React;
- status results stuck in `verifying` beyond the configured timeout;
- completed quest versus displayed-balance discrepancies.

Alerts:

- any on-chain delivery processing for more than 10 minutes;
- any off-chain ledger delivery left pending after its request transaction;
- any second completed delivery for one canonical quest/scope;
- any catalog binding/configuration mismatch;
- nonzero reconciliation drift after the migration window.

## 15. Test matrix

The release suite must cover:

1. Walletless Hub user completes pass, deal, country, and voucher quests.
2. Walletless Hub user cannot falsely complete the sponsored-game quest.
3. React completion appears completed in Hub after linking the same wallet.
4. Hub wallet completion appears pending/completed in React through the same
   mint job.
5. Hub walletless completion appears completed in React after later wallet
   linking and does not mint again.
6. Concurrent Hub and React claims produce one completion and one delivery.
7. One-time quests cannot be repeated through a second linked wallet.
8. The sponsored quest can repeat in the next ISO week but not the same week.
9. Failed mint retry reuses the delivery and eventually completes once.
10. A ledger failure produces no completion or balance change.
11. Changing or reusing an email does not transfer a completion without the
    authenticated account/identity-link rules.
12. Canonical merge preserves both historical balances and collapses duplicate
    quest scopes without reward replay.
13. Backfill creates no mint jobs or ledger credits.
14. A missing binding returns `service_unavailable`, never endless
    `verifying`.
15. React and Hub render the same canonical state and awarded amount for every
    fixture.

## 16. Acceptance criteria

The work is ready for general rollout when:

- the five `api_partner_quests` bindings pass readiness checks;
- both apps read the same canonical completion projection;
- React's current wallet claim and mint test suite remains green;
- a walletless Hub member can earn every non-wallet quest reward;
- linking a wallet never duplicates a walletless reward;
- completion and combined balance agree in both apps;
- one full weekly rollover passes without duplicate sponsored rewards;
- legacy versus canonical reconciliation is zero for successful claims;
- failures are retryable without changing participant, completion, or
  idempotency keys.

## 17. Implementation workstreams

1. **Data:** catalog bindings, canonical completions/deliveries, account
   bindings, merge and reservation RPCs.
2. **React adapter:** canonical resolution, reserve-before-queue, worker
   finalization, canonical-first status, combined balance.
3. **Hub adapter:** Hub evidence verification, canonical status, wallet and
   walletless claim paths, precise UI states.
4. **Migration:** successful-record backfill and reconciliation tooling.
5. **Quality:** cross-app contract fixtures, concurrency tests, weekly boundary
   tests, identity security tests, and rollout dashboards.

The data/RPC workstream lands first. React mirroring and dual-read land before
Hub walletless claims so React remains the stable reference path throughout
the rollout.
