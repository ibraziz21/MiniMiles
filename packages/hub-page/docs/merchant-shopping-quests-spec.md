# Merchant and shopping quests for Akiba Hub

**Package:** `packages/hub-page`  
**Reference implementation:** `packages/react-app/app/earn`  
**Status:** Proposed  
**Scope:** Review and implementation specification only

## 1. Decision

Replace the current partner/on-chain quest presentation on `/quests` with
Akiba-owned merchant and shopping quests adapted from `react-app/earn`.

Keep the Akiba Platform partner-quest adapters and card implementation in the
codebase, but do not mount them in the launch UI. They remain useful for future
paid partner inventory.

The Hub quest experience must be account-first:

- an authenticated email-only member can complete and receive every
  Hub-native quest reward that does not inherently require a wallet;
- a member with a linked wallet gets the same off-chain reward path;
- linking a wallet later merges identities instead of creating a second quest
  history or reward balance;
- no Hub-native quest claim may require MiniPay merely as a payout address.

## 2. Current-state review

### React app

`react-app/earn` mounts five merchant-discovery quests:

1. Get your Akiba Pass — 20 Miles, once.
2. Browse this week's merchant deals — 5 Miles, once.
3. Play the sponsored leaderboard — 25 Miles, weekly.
4. Complete your profile — 50 Miles, once.
5. Redeem your first voucher — 100 Miles, once.

The catalog is appropriate, but its implementation is wallet-first. Progress,
engagements, weekly claims, mint jobs, action proofs, and rollout assignment
are keyed by wallet address. The Hub must reuse the quest intent and verified
domain signals, not copy that identity model.

### Hub page

The current `/quests` page:

- fetches generic partner quests from `GET /api/v1/hub/quests`;
- groups them by chain and partner;
- uses copy about on-chain partner tasks;
- shows an unrelated Celo/MiniPay preview when the feed is empty;
- requires a linked MiniPay wallet in `POST /api/quests/claim`;
- does not load authenticated per-user status safely on the server page;
- gives `action_url` precedence over claim, so a quest with an action URL has
  no return-to-claim state in the current card;
- has no active/completed separation or durable queued-reward state.

The Hub already has the right primitives for an account-first replacement:

- Supabase email authentication and stable `auth.users.id`;
- `buildIdentities()` for email plus all linked wallets;
- Platform canonical identities and the off-chain `miles_ledger`;
- a balance that combines off-chain ledger Miles and on-chain Miles;
- a durable `internal_event_jobs` outbox;
- durable events for `pass_activated` and `voucher_redeemed`;
- a sponsored-game completion webhook from `react-app`;
- `hub_user_id` ownership on Hub-issued vouchers.

## 3. Launch catalog

| Key | User-facing quest | Reward | Frequency | Hub action | Verification |
|---|---|---:|---|---|---|
| `pass_activated` | Get your Akiba Pass | 20 | Once | `/pass` | A `hub_user_passes` row exists for the authenticated user; use the existing durable `pass_activated` event. |
| `deal_viewed` | Browse this week's merchant deals | 5 | Once | `/vouchers` | Record a server-validated view of an active, available voucher or published merchant offer. A page view alone is not proof. |
| `sponsored_game_played` | Play the sponsored leaderboard | 25 | Weekly | `react-app` sponsored challenge URL | Existing accepted sponsored-game session for the active campaign and ISO week. Existing Platform webhook remains the proof source. |
| `profile_country_set` | Tell us where you shop | 50 | Once | `/me` profile editor | Authenticated Hub profile has a valid country. Add a Hub-owned profile field so email-only users can complete it. |
| `voucher_redeemed` | Use your first voucher | 100 | Once | `/vouchers` | An owned voucher reaches `status='redeemed'`; use the existing durable `voucher_redeemed` event. |

### Catalog adjustments

- Use “Tell us where you shop” rather than “Complete your profile”. The
  verification is one explicit country field, not an undefined completion
  percentage.
- Use “Use your first voucher” to distinguish merchant redemption from
  spending Miles to acquire a voucher.
- Keep the sponsored leaderboard in the catalog because it is merchant-funded
  discovery inventory. Mark it “Wallet required” only when the member has no
  linked wallet; the reward itself is still account-bound and off-chain.
- Rewards at or below 20 Miles may use low-friction behavioral proof. Rewards
  above 20 Miles require a durable first-party domain event.

## 4. Identity and reward model

### Canonical participant

The quest participant is the authenticated Hub account, represented by:

- `hubUserId` as the stable local owner;
- email as the initial Platform identity;
- every linked wallet as additional Platform identities.

Every Hub-emitted quest event must use `buildIdentities({ userId, email })`.
Never select a single “reward wallet” before sending a Hub-native quest event.

When a wallet is linked later, replay/merge the participant identities using
the existing identity-enrichment pattern used by `reemitPassActivated`.
Completion and reward uniqueness must resolve at the Platform canonical
identity, not independently per email and wallet.

### Reward delivery

Use one payout policy for wallet and walletless members:

1. A verified quest creates one Platform reward for the canonical participant
   and quest scope.
2. Claiming credits the Platform off-chain Miles ledger.
3. The reward is immediately visible in the Hub's combined balance and
   spendable by ledger-aware voucher flows.
4. Linking a wallet later must not remint or duplicate the reward.
5. On-chain bridging/minting, if offered, is a separate balance action and not
   part of an individual quest claim.

This avoids gas and mint latency, supports email-only members, and prevents two
reward delivery modes from drifting.

Required uniqueness:

```text
(canonical_participant, quest_key, scope_key)
```

For one-time quests, `scope_key = "lifetime"`. For the sponsored leaderboard,
`scope_key = <ISO week>`.

### Platform contract requirement

Before implementation, verify that Platform reward lookup exposes an ownership
identifier suitable for email-first rewards, such as `canonicalId` or
`recipient: { type, value }`.

The Hub claim BFF must validate a reward against the member's canonical
participant or complete identity set. The current wallet-address-only
ownership check used by React app's Platform BFF is not sufficient.

If Platform cannot issue and authorize a reward without `walletAddress`, add
that upstream capability before enabling Hub claims. Do not restore the
MiniPay gate as a fallback.

## 5. Completion and event flow

```text
Member action
  -> first-party Hub/React domain record
  -> durable outbox event with email + linked-wallet identities
  -> Platform quest verification/completion
  -> reward becomes claimable
  -> member claims to canonical off-chain Miles ledger
  -> Hub status shows completed and combined balance refreshes
```

### Pass

- Existing users with a pass qualify retroactively.
- New pass creation continues to enqueue `pass_activated` atomically.
- Opening `/pass` is the action CTA, but merely opening the route is not the
  authoritative proof; the pass row is.

### Deal view

Add an authenticated proof endpoint. It accepts a voucher template ID or
merchant offer reference and validates that it is currently public and
available before enqueueing:

```json
{
  "event_type": "deal_viewed",
  "idempotency_key": "deal-viewed:<hub-user-id>:<offer-id>",
  "identities": ["email and all linked wallets"],
  "metadata": {
    "hubUserId": "<uuid>",
    "offerId": "<uuid>",
    "merchantId": "<uuid>"
  }
}
```

Trigger it from a real offer-card/detail interaction. Never accept a client
claim with no server-side offer validation.

### Sponsored leaderboard

- Continue using the accepted `skill_game_sessions` record and existing
  sponsored-game outbox/webhook in `react-app`.
- Platform must merge the wallet proof into the same canonical participant as
  the Hub email account.
- If no wallet is linked, show the wallet requirement before sending the
  member to the game.
- Weekly status and reward uniqueness use the same ISO-week helper/convention
  as the React app.

### Country

Add a minimal Hub-owned profile record keyed by `auth.users.id`:

```text
hub_user_profiles
  user_id uuid primary key references auth.users(id)
  country text null
  created_at timestamptz
  updated_at timestamptz
```

The `/me` editor writes this record through an authenticated API. On the first
transition from no valid country to a valid country, enqueue
`profile_country_set` with all known identities. Legacy wallet-profile country
may prefill this field, but the Hub record becomes the Hub quest verifier so
walletless users are first-class.

### Voucher redemption

- Reuse the existing `voucher_redeemed` outbox event.
- Verify ownership by `hub_user_id` first and linked wallet second.
- Merchant-scan and Hub-checkout redemption paths must produce the same event
  key semantics.
- Existing historical redeemed vouchers qualify retroactively after ownership
  resolution.

## 6. Hub API and UI contracts

### `GET /api/quests/status`

Authenticated, `private, no-store`.

Returns the local launch catalog joined with Platform completion/reward state:

```ts
type HubQuestState =
  | "needs_action"
  | "wallet_required"
  | "verifying"
  | "claimable"
  | "claiming"
  | "completed"
  | "reward_failed";

type HubQuestStatus = {
  key: string;
  scopeKey: string;
  state: HubQuestState;
  rewardId: string | null;
  miles: number;
  reason?: string;
};
```

Do not cache this response across users. A Platform outage returns a degraded
status without erasing known local progress.

### `POST /api/quests/proof`

Authenticated. Launch use: `deal_viewed` only.

- validate the supplied offer against live Hub inventory;
- build identities server-side;
- enqueue a durable internal event;
- return `202 { queued: true }`;
- dedupe repeated views.

### `POST /api/quests/claim`

Replace the current `quest_id -> MiniPay wallet -> /hub/quests/:id/claim`
contract for the mounted Hub catalog.

New contract:

```json
{ "rewardId": "<platform-reward-id>" }
```

The route:

1. authenticates the Hub member;
2. resolves email, linked wallets, and canonical participant;
3. fetches the reward from Platform;
4. verifies ownership against that participant;
5. claims idempotently;
6. returns awarded Miles and the terminal/queued state.

No wallet is required.

### Page structure

Replace the chain/partner layout with:

- heading: **Earn Miles**
- supporting copy: **Shop, explore offers, and use your Akiba Pass.**
- Active and Completed tabs;
- a compact total/available Miles summary for signed-in members;
- merchant quest cards in catalog order;
- an optional, unmounted Partner offers section retained for later.

Card states:

- signed out: “Sign in to start”;
- needs action: action-specific CTA;
- wallet required: “Link wallet to play”;
- verifying: non-destructive retry/status copy;
- claimable: “Claim X Miles”;
- completed: completion check and earned amount;
- failed: “Reward needs attention” with retry, without repeating the action.

After returning from an internal action route, refresh quest status. Do not
store authoritative completion in browser local storage.

## 7. Partner inventory retention

Retain these files for future partner inventory:

- `src/app/api/quests/route.ts`
- the generic Platform feed fetcher, moved out of the page component;
- the existing generic partner card, renamed to make its purpose explicit;
- chain metadata and partner grouping helpers.

Unmount the partner inventory through a named launch flag and explanatory
comment:

```ts
const SHOW_PARTNER_QUESTS = false;
```

Do not leave a large commented JSX block in the page. Do not render the
current Celo/MiniPay preview when partner inventory is disabled.

The future partner section must use the same account-first status and reward
ownership contract before this flag is enabled.

## 8. Implementation slices

### Slice 1 — catalog and presentation

- Add the local Hub quest catalog.
- Replace `/quests` copy, grouping, preview, and card states.
- Add authenticated status BFF using email plus linked wallets.
- Unmount partner inventory behind `SHOW_PARTNER_QUESTS`.

### Slice 2 — walletless claim path

- Add canonical/email reward ownership to the Platform contract if required.
- Replace the MiniPay-only claim BFF.
- Refresh Hub balance and quest status after claim.

### Slice 3 — missing proof producers

- Add validated `deal_viewed` proof and durable event.
- Add `hub_user_profiles.country`, the `/me` editor, and
  `profile_country_set`.
- Backfill/replay pass, country, and redeemed-voucher eligibility for existing
  users without duplicating completions.

### Slice 4 — hardening and rollout

- Add outbox and reward failure observability.
- Add a server-side feature flag/allowlist for the new Hub catalog.
- Roll out to internal accounts, then a percentage cohort, then all members.

## 9. Acceptance criteria

- `/quests` shows the five Akiba merchant/shopping quests and no chain-grouped
  partner inventory or irrelevant preview.
- An email-only member can complete Pass, deal-view, country, and voucher
  quests and claim Miles without linking MiniPay.
- A linked-wallet member follows the same ledger reward path.
- A later wallet link merges status and balance and does not duplicate a
  reward.
- Sponsored leaderboard is weekly, requires a verified accepted session, and
  rewards the Hub participant after identity merge.
- Pass, profile, and voucher actions are server-verified; deal-view proof is
  validated against live inventory.
- Repeated event delivery and repeated claim requests are idempotent.
- Platform or worker downtime shows queued/verifying state and recovers
  without requiring the member to repeat the merchant action.
- Completed quests remain separate from active quests.
- Partner adapters remain typechecked and testable while unmounted.

## 10. Test plan

- Catalog rendering for anonymous, email-only, and linked-wallet members.
- Status resolution across email-only, wallet-only legacy, and merged
  identities.
- Reward ownership rejects another user's reward ID.
- Walletless claim succeeds and credits the expected canonical ledger.
- Duplicate claim/event delivery produces one ledger credit.
- Pass and historical voucher backfill are idempotent.
- Deal proof rejects inactive, expired, sold-out, hidden, or unknown offers.
- Country transition emits once and invalid input emits nothing.
- Sponsored quest resets on ISO-week boundary but not within the same week.
- Platform failure preserves local progress and returns a retryable state.
- Partner inventory flag off performs no partner-feed request.

## 11. Out of scope

- Daily transaction challenges from `react-app`.
- Vault rewards, polls, streaks, and profile milestone minting.
- Rebuilding the Akiba Platform partner campaign authoring system.
- Automatic on-chain minting for each Hub quest.
- Enabling paid partner inventory at launch.
