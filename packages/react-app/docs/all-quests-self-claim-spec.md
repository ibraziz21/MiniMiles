# Spec: User-Paid Self-Claim for All Interactive Quests

**Package:** `packages/react-app`  
**Supporting packages:** `packages/backend`, `supabase`, `packages/hardhat` (reference only)  
**Contract:** Existing Celo `DailyQuestClaimer` at `0xa9e6adb52e74151553c140615a09119d501c75ce`  
**Status:** Implementation-ready  
**Supersedes:** The new-contract recommendation in §15 of `daily-checkin-self-claim-spec.md`

---

## Context

Daily check-in already uses a server-signed EIP-712 voucher. The user's wallet
submits `claim()` to the deployed Celo `DailyQuestClaimer`, pays gas, and the
server reconciles the receipt before recording completion.

The deployed contract can serve more than one quest per day without a new
deployment. Although its ABI names the replay key `dayNonce`, `claim()` never
checks that the value equals the current UTC day. It only verifies:

1. the signed voucher has not expired;
2. `(msg.sender, dayNonce)` has not already been claimed;
3. the signature covers the caller, amount, nonce, and deadline; and
4. AkibaMiles minting succeeds.

Therefore `dayNonce` can be treated as a generic `claimNonce` by the app while
retaining the deployed ABI and EIP-712 schema. Existing daily check-in nonces
remain unchanged for backward compatibility; every other quest receives a
namespace-separated deterministic nonce.

This spec migrates **interactive quest claims** to user-paid gas. It does not
convert unrelated automatic rewards merely because they also mint AkibaMiles.

## Goals

1. Reuse the existing Celo claimer for all interactive quests in react-app.
2. The claimant's authenticated wallet submits the transaction and pays gas.
3. Preserve existing eligibility, blacklist, stable-hold, vault-boost,
   completion, streak, history, canonical-delivery, and analytics behavior.
4. Give every wallet at most one reward for each logical quest completion.
5. Make rejection, revert, expiry, dropped transactions, browser closure, and
   retries safe and recoverable.
6. Prevent sponsored and self-claim delivery from paying the same completion.
7. Roll out per quest family without a flag day or contract deployment.

## Scope

### Included

| Family | Current entry points | Scope model | Completion finalizer |
|---|---|---|---|
| Daily check-in | `/api/quests/daily/voucher` | UTC day | `daily_engagements` |
| Daily transfer/receive | `/api/quests/daily_transfer`, `daily_receive` | UTC day | `daily_engagements` |
| Daily transfer counts | `daily_5_tx`, `daily_10_tx`, `daily_20_tx` | UTC day | `daily_engagements` |
| Daily Kiln hold | `daily_kiln_hold` | UTC day | `daily_engagements` |
| Daily balance/game streaks | `/api/streaks/balances`, `/api/streaks/games` | UTC day | `daily_engagements` + `streaks` |
| Weekly top-up streak | `/api/streaks/topup` when enabled | ISO week | `daily_engagements` + `streaks` |
| Seven-day send streak reward | `/api/quests/seven_day_streak` | earned streak instance | `daily_engagements` |
| Direct partner quests | `/api/partner-quests/claim`, `username` | lifetime or ISO week | partner completion table |
| Externally verified partner quests | Pretium confirmation flow | verified reward instance | `partner_engagements` |
| Platform discovery quests | `/api/quests/platform/claim` + reward webhook | Platform reward ID | Platform delivery record |
| Profile milestone quests | `/api/profile/claim-milestone` | milestone 50 or 100 | user milestone flag |

### Excluded

These remain on their existing contract or backend settlement path:

- order Miles, referrals, signup rewards, vault snapshots, and marketing grants;
- game settlement and prize contracts, Claw rewards, raffles, and leaderboard
  settlement;
- poll rewards until poll submission can return a durable claim step without
  changing the completed-response transaction;
- burns, purchases, deposits, withdrawals, and any non-mint transaction;
- any reward delivered while the user is absent and has no claim UI.

An excluded automatic reward may move later, but only after adding a durable
"reward ready — claim" experience. This spec must not turn background jobs
into silently stranded vouchers.

## Non-goals

- No new smart contract, proxy, upgrade, or Celo deployment.
- No change to the deployed EIP-712 domain or `QuestClaim` type.
- No paymaster, relayer, gas refund, or Akiba-paid fallback while a quest is in
  self-claim mode.
- No client-selected wallet, amount, nonce, contract, reward multiplier, or
  completion table.
- No deletion of the mint queue; it remains for excluded automatic rewards.

---

## 1. Contract reuse and compatibility

Continue using the deployed ABI:

```solidity
function claim(
  uint256 amount,
  uint256 dayNonce,
  uint256 deadline,
  bytes signature
) external;

function claimed(address user, uint256 dayNonce) external view returns (bool);
```

Continue using the deployed EIP-712 domain and type exactly:

```ts
domain = {
  name: "DailyQuestClaimer",
  version: "1",
  chainId: 42220,
  verifyingContract: DAILY_QUEST_CLAIMER_ADDRESS,
}

QuestClaim = [
  { name: "user", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "dayNonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
]
```

The wire/API field remains `dayNonce` for compatibility. New internal code
must call it `claimNonce` and convert only at the signer/contract boundary.

Do not redeploy the current `packages/hardhat` source as part of this work. It
is useful behavioral reference, but its event and blacklist interface are not
assumed to be byte-for-byte identical to the existing Celo deployment.

## 2. Deterministic claim nonce

### Existing daily check-in

Keep its current nonce unchanged:

```ts
claimNonce = BigInt(Math.floor(unixSeconds / 86400));
```

Changing it would create a second replay slot for the same day and could allow
an old epoch-day voucher and a new hashed voucher to both mint.

### Every other quest

Derive the nonce from a canonical quest ID and scope key, then set the high bit:

```ts
const GENERIC_NONCE_NAMESPACE = 1n << 255n;

const digest = keccak256(
  encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "string" },
      { type: "string" },
    ],
    [
      keccak256(stringToHex("AKIBA_QUEST_SELF_CLAIM_V1")),
      questId,
      scopeKey,
    ],
  ),
);

const claimNonce = BigInt(digest) | GENERIC_NONCE_NAMESPACE;
```

The high bit gives an explicit namespace boundary from legacy epoch-day
nonces. The remaining 255-bit hash space is sufficient; the database also
enforces uniqueness per wallet.

Rules:

- `questId` is the server-resolved canonical quest identifier.
- `scopeKey` is server-derived and normalized; never accept an arbitrary scope
  string from the browser.
- Do not include reward amount in the nonce. Amount is frozen in the intent;
  changing a configured reward must not create a second replay slot.
- The contract already namespaces by wallet through
  `claimed(wallet, claimNonce)`, so the wallet is not included in the hash.
- Multiple legitimate completions of the same quest in one period must include
  a stable completion instance in `scopeKey`.

Canonical scope keys:

| Semantics | Format | Example |
|---|---|---|
| Daily | UTC `YYYY-MM-DD` | `2026-09-12` |
| Weekly | ISO `YYYY-Www` | `2026-W37` |
| Once ever | Literal | `lifetime` |
| Profile milestone | Milestone | `milestone:50` |
| External completion | Provider ID | `completion:<id>` |
| Platform reward | Platform reward ID | `reward:<rewardId>` |
| Earned streak award | Stable earned instance | `streak:<start-date>:<end-date>` |

All date/week calculation must live in one UTC-safe shared module. Remove local
copies that use local-year/month values or produce inconsistent ISO weeks.

## 3. Voucher lifetime and reward freezing

Freeze these values on first successful eligibility reservation:

- authenticated wallet;
- canonical quest ID and scope key;
- claim nonce;
- base points;
- vault boost and final awarded points;
- amount in 18-decimal units;
- finalizer kind and payload;
- external/canonical proof references.

Retries never recompute them, even if configuration, eligibility evidence, or
vault balance changes later.

Deadline policy:

| Scope | Voucher deadline |
|---|---|
| Daily | Final second of that UTC day |
| Weekly | Final second of that ISO week |
| Earned-instance/lifetime | 15 minutes after issue |

For lifetime and instance claims, an expired unsubmitted voucher may be
reissued with a later deadline using the same intent, nonce, amount, and
finalizer. Daily/weekly claims may only refresh a deadline while their scope is
still open. An old signed voucher may remain usable until its signed deadline;
the shared nonce guarantees only one version can succeed.

Use bigint math throughout. A points value becomes
`BigInt(points) * 10n ** 18n` only after validating it is a positive safe
integer and below the configured cap.

## 4. Generalized claim-intent data model

Do not rename or replace `daily_quest_claim_intents` during the rollout. Expand
it in a forward-only migration and treat its table name as compatibility debt.
This avoids losing the working daily-check-in recovery state during a rolling
deploy.

Add:

| Column | Type | Purpose |
|---|---|---|
| `scope_key` | `text` | Canonical replay/idempotency scope |
| `claim_nonce` | `text` | Decimal uint256; hashed values do not fit PostgreSQL `bigint` |
| `claim_family` | `text` | Registry key used for rollout and metrics |
| `finalizer_kind` | `text` | Server-controlled completion handler |
| `finalizer_payload` | `jsonb` | Frozen, validated completion data |
| `eligibility_ref` | `text` | Optional attestation/reward/completion reference |
| `chain_confirmed_at` | `timestamptz` | Receipt/event verified |
| `legacy_job_id` | `uuid` | Optional conflicting sponsored job reference |

Migration requirements:

1. Backfill daily check-in `scope_key = claim_date::text` and
   `claim_nonce = day_nonce::text`.
2. Backfill `claim_family = 'daily_checkin'`, finalizer kind, and payload.
3. Convert `quest_id` from UUID to text if necessary; Platform identifiers and
   future canonical IDs must not be forced to UUID.
4. Keep `day_nonce` and `claim_date` for old code, but allow them to be null for
   non-daily intents. New code reads `claim_nonce` and `scope_key`.
5. Replace the old `(user_address, quest_id, claim_date)` intent uniqueness
   with `(user_address, quest_id, scope_key)` after the backfill.
6. Add unique `(user_address, claim_nonce)` as collision and implementation
   protection.
7. Add indexes on `(user_address, status)`, `(claim_family, status,
   updated_at)`, and `(status, updated_at)`.
8. Expand the status check to `issued`, `submitted`, `chain_confirmed`,
   `confirmed`, and `expired`.
9. Keep RLS enabled with no anonymous/authenticated write policy.

`status = confirmed` continues to mean both the chain mint and the local
domain finalizer completed. `chain_confirmed` means the mint is irreversible
but finalizer side effects still need an idempotent retry.

Add `source` and `tx_hash` columns, where absent, to completion tables written
by self-claim finalizers. Existing readers must continue working.

## 5. Server architecture

### 5.1 Shared modules

Generalize the daily modules without duplicating a second implementation:

| Current module | Target responsibility |
|---|---|
| `dailyQuestClaimer.ts` | Rename exports conceptually to generic claimer ABI, voucher, nonce, and date/week helpers; keep compatibility aliases |
| `dailyClaimSigner.ts` | Generic signer using the same key/domain/type |
| `dailyClaimConfig.ts` | Generic on-chain config validation and cache |
| `dailyClaimIntents.ts` | Generic intent lifecycle and reconciliation |
| `dailyVoucherRateLimit.ts` | Generic per-wallet/IP voucher limiter |
| `dailySelfClaimMode.ts` | Per-family self-claim rollout policy |
| `questReward.ts` | Shared frozen vault-boost calculation, unchanged |

Do not import any signer/key-loading module into a client-safe module.

### 5.2 Eligibility adapter registry

Each claim family implements a server-only adapter:

```ts
type QuestEligibilityResult = {
  questId: string;
  scopeKey: string;
  basePoints: number;
  scopeEndsAt?: Date;
  eligibilityRef?: string;
  finalizer: {
    kind: QuestFinalizerKind;
    payload: Record<string, unknown>;
  };
};

type QuestClaimAdapter<Input> = {
  family: string;
  resolveIdentity(input: Input, session: Session): Promise<{
    questId: string;
    scopeKey: string;
  }>;
  verifyEligibility(input: Input, session: Session): Promise<QuestEligibilityResult>;
};
```

`resolveIdentity` may select among a fixed server allowlist, but cannot accept
amount, nonce, contract, finalizer, or raw scope from the client. It enables an
existing intent to be found and retried without rerunning transient eligibility
checks. `verifyEligibility` runs only when no intent exists.

Extract existing route logic into adapters; do not copy the eligibility query
into separate legacy and voucher routes.

### 5.3 Voucher issuance order

1. Require a wallet session and use only `session.walletAddress`.
2. Resolve the claim family, canonical quest ID, and scope.
3. Apply rollout gate, blacklist/stable-hold rules, and rate limit.
4. Validate chain, bytecode, token, signer, and minter configuration.
5. Reconcile the wallet's stale nonterminal intents, bounded by count and age.
6. Look up the intent by `(wallet, questId, scopeKey)`.
7. If an intent exists, reconcile/reissue it without recomputing its reward.
8. If none exists, check for a legacy mint job/completion for the same logical
   idempotency key. Never issue while a sponsored job may still mint.
9. Run eligibility and reserve any one-time proof.
10. Compute the vault boost once, cap it, derive the nonce, and atomically
    insert the intent. Concurrent losers load the winning frozen row.
11. Check `claimed(wallet, claimNonce)` before signing. If true, reconcile.
12. Sign only values loaded back from the stored intent.

The signer must never sign values assembled directly from request JSON.

### 5.4 APIs

Use one generic confirmation/status surface:

- `POST /api/quests/self-claim/confirm`
  - body: `{ intentId, txHash }`
- `GET /api/quests/self-claim/status?intentId=<uuid>&txHash=<optional>`
- `GET /api/quests/self-claim/pending`
  - returns the authenticated wallet's bounded nonterminal intents for
    cross-device/app recovery.

Add thin voucher routes that call the extracted eligibility adapters. Do not
change a legacy queue route to return a voucher: a cached client would treat
the response as a completed/queued claim but would never submit it on-chain.

| Family | Voucher route |
|---|---|
| Daily check-in | Existing `/api/quests/daily/voucher` |
| Transfer/receive/count/Kiln | Append `/voucher` to each existing quest route |
| Balance/game/top-up streak | Append `/voucher` to each existing streak route |
| Seven-day reward | `/api/quests/seven_day_streak/voucher` |
| Direct partner | `/api/partner-quests/claim/voucher` |
| Username | `/api/partner-quests/username/voucher` |
| Pretium/verified partner | `/api/partner-quests/pretium/voucher` |
| Platform | `/api/quests/platform/self-claim` |
| Profile milestone | `/api/profile/claim-milestone/voucher` |

For a wallet in self-claim mode, the corresponding legacy queue endpoint must
return `409 { code: "self-claim-required" }` before enqueueing or consuming a
one-time proof. New clients call the voucher route directly. A family whose
mode is off continues using its legacy endpoint.

Issued vouchers return:

```ts
type IssuedSelfClaimVoucherResponse = {
  success: true;
  delivery: "self-claim";
  status: "issued";
  intentId: string;
  family: string;
  questId: string;
  scopeKey: string;
  points: number;
  vaultBoost: QuestVaultBoost;
  contractAddress: `0x${string}`;
  amount: string;
  dayNonce: string; // generic claimNonce in the deployed ABI
  deadline: string;
  signature: `0x${string}`;
};

type SubmittedSelfClaimResponse = {
  success: false;
  delivery: "self-claim";
  status: "submitted";
  code: "submitted";
  intentId: string;
  family: string;
  questId: string;
  scopeKey: string;
  points: number;
  txHash: `0x${string}`;
};
```

For `submitted`, the client resumes status polling instead of opening the
wallet again.

Daily's current voucher/confirm/status routes remain compatibility aliases
until all released clients use the generic endpoints.

### 5.5 Authentication corrections

As part of this migration, `/api/streaks/games`, `/api/streaks/balances`, and
`/api/streaks/topup` must stop trusting `userAddress` from request JSON. Require
the existing session and derive the wallet from it. Quest IDs and balance tiers
must map through a fixed server registry; unknown combinations return 400.

This is required before those routes can access the voucher signer.

## 6. Reconciliation state machine

```text
issued -> submitted -> chain_confirmed -> confirmed
   |          |              |
   |          +-> issued      +-> chain_confirmed (finalizer retry)
   +-> expired
```

- `issued`: voucher exists; no trusted broadcast is known.
- `submitted`: a valid-format hash is recorded but not yet proven.
- `chain_confirmed`: receipt and event, or authoritative `claimed()`, prove the
  mint; no new voucher may be returned.
- `confirmed`: the idempotent domain finalizer succeeded.
- `expired`: scope closed without a proven claim.

All nonterminal updates use compare-and-set on intent ID, wallet, prior status,
and transaction hash. A late pending/revert result cannot move a confirmed row
backward.

For a supplied transaction hash, require:

- a successful Celo receipt;
- `receipt.from` equals the intent wallet;
- `receipt.to` equals the configured claimer;
- a deployed-contract `QuestClaimed` event matching wallet, nonce, and amount;
- no conflicting transaction already verified for the intent.

If the actual deployed event name/layout differs from repository source, keep
the ABI matching the verified Celo deployment.

When the receipt is unavailable:

- before the stale threshold, remain `submitted`;
- after the threshold, call `claimed(wallet, nonce)`;
- `true` moves to `chain_confirmed` and runs the finalizer;
- a genuine `false` may reset to `issued` while the scope remains open;
- an RPC error remains `submitted`; it must never be interpreted as false;
- after scope expiry, a genuine false moves to `expired`.

`claimed() = true` without a known hash is sufficient only because the nonce is
deterministic, the intent exists before signing, and every reissue freezes the
same amount. Preserve all three invariants.

## 7. Idempotent completion finalizers

Finalizers accept a stored intent, not client data. They may run repeatedly.

| Kind | Required effects after chain confirmation |
|---|---|
| `daily_engagement` | Upsert `(wallet, quest, scope date)`, points, source, tx hash |
| `streak_engagement` | Upsert daily/weekly engagement, then atomically advance the streak once for `scopeKey` |
| `partner_engagement` | Upsert once-ever partner completion and complete canonical delivery if present |
| `partner_weekly_engagement` | Upsert `(wallet, quest, ISO week)` and complete canonical delivery |
| `profile_milestone` | Set the exact 50/100 claimed flag and record tx hash/source |
| `platform_reward` | Mark the local Platform reward delivery complete by reward ID and tx hash |

Streak advancement needs a database RPC/transaction keyed by
`(wallet, questId, scopeKey)`. The current read-then-update helper can race and
must not be used as the finalizer. Streak state advances only after on-chain
confirmation, not when a voucher is issued.

For canonical partner quests, chain confirmation completes the existing
canonical delivery with the transaction hash. A finalizer failure does not
mark the delivery failed or issue another voucher; it stays `chain_confirmed`
and retries.

## 8. Quest-family requirements

### 8.1 Daily Challenges and streaks

- Preserve every existing eligibility query and user-facing reason.
- Put `daily_20tx` into `questRegistry.ts`; remove its fallback string ID and
  hard-coded reward.
- Derive all daily dates through the shared UTC helper.
- Derive all ISO weeks through one UTC-correct helper.
- The seven-day reward scope must identify the earned streak instance, not the
  day the user happened to press Claim. Otherwise a delayed retry could collide
  with a later earned streak.
- Raffle eligibility that currently checks mint jobs must recognize a
  `chain_confirmed`/`confirmed` self-claim intent during the cutover, but an
  merely `issued` voucher must not satisfy the requirement.

### 8.2 Direct partner quests

- Preserve stable-hold, blacklist, merchant verification, and attestation
  checks.
- A once-ever quest uses `scopeKey = lifetime`; the sponsored leaderboard uses
  its ISO week.
- Reserve/consume the attestation and create the claim intent atomically, or
  make proof consumption recoverable by the winning intent. A database write
  failure must not burn the user's only attestation.
- The username mutation may occur before voucher issuance, but setting a
  username alone must not mark the reward completed. The user can return and
  claim the frozen intent later.

### 8.3 Externally verified partner quests

- Admin/provider confirmation stops enqueueing a mint when the family is in
  self-claim mode.
- It instead creates a durable verified-reward/intent record with the frozen
  amount and deterministic external completion scope.
- UI states become `pending verification -> ready to claim -> submitted ->
  completed`.
- A provider retry must return the same record; it cannot create another nonce.

### 8.4 Platform discovery quests

The current Platform claim triggers `reward_issued`, whose react-app webhook
enqueues a sponsored mint. Issuing a local voucher in addition to that webhook
would double-pay, so this family has a separate bridge cutover:

1. User requests the Platform reward through the existing authenticated BFF.
2. Platform validates ownership and marks/releases the reward as it does today.
3. While self-claim is enabled for this family, `reward_issued` creates or
   reuses a `platform_reward` claim intent keyed by `rewardId`; it does **not**
   enqueue `minipoint_mint_jobs`.
4. The BFF response returns `preparing` if the webhook has not arrived yet.
5. The client polls a wallet-scoped preparation/status endpoint until the
   stored Platform reward amount is available, then receives the voucher.
6. On-chain confirmation finalizes the local Platform delivery record.

Webhook redelivery is idempotent by `rewardId`. Existing Platform status may
say claimed before the Celo mint lands; react-app's local intent is the delivery
authority and must display `ready to claim` until confirmed. If Platform later
adds a delivery-confirm endpoint, call it from the idempotent finalizer.

Never sign an amount taken only from a browser or an unverified Platform GET.
Use the authenticated, signature-verified `reward_issued` payload already
trusted by the current bridge.

### 8.5 Profile milestones

- Preserve Turnstile, stable-hold, username, and completion-percentage checks.
- Use server registry entries for the 50 and 100 milestones.
- Scope keys are `milestone:50` and `milestone:100`.
- The claimed boolean is set only after on-chain confirmation.
- Existing completed or potentially minting legacy jobs block voucher issuance.

## 9. Client orchestration

Replace the check-in-specific client code with one `runQuestSelfClaim()` flow:

1. Call the family adapter/entry route and obtain a stored voucher.
2. If `submitted`, restore its pending state and poll.
3. Simulate the deployed `claim()` call from the connected wallet.
4. Ask the wallet to submit; show explicitly that the user pays Celo gas.
5. Persist `{wallet, intentId, family, questId, txHash}` before any confirm call.
6. Fire-and-forget generic confirmation.
7. Poll generic status with the hash as a reconciliation hint.
8. On `confirmed`, refresh balance and the relevant quest/completion view.
9. On revert/drop while scope is open, show Retry.
10. On UI timeout, show Still confirming and do not clear persistence.

Use `claimQuestOnchain()` as the generic name and retain
`claimDailyQuestOnchain()` as a temporary alias. Simulation and submission
continue to append Celo attribution.

Pending persistence must support multiple simultaneous quests per wallet. Use
one wallet-scoped collection keyed by intent ID, not the current single daily
localStorage record. On app mount:

- load local pending intents;
- also query the server's wallet-scoped `/pending` endpoint, enabling
  cross-device recovery;
- reconcile a bounded number in the background;
- never open a result modal for silent recovery;
- remove only terminal `confirmed` or `expired` entries.

The shared result sheet keeps `success`, `already`, `error`, and `pending`.
Quest-specific UI refresh callbacks may differ, but transaction orchestration
must not be copied per component.

## 10. Rollout and legacy exclusion

Use a generic policy:

```text
QUEST_SELF_CLAIM_MODE=off|allowlist|on
QUEST_SELF_CLAIM_ALLOWLIST=0x...,0x...
QUEST_SELF_CLAIM_FAMILIES=daily_checkin,daily_transfer,...
```

- `MODE=off`: enabled families use their current sponsored behavior.
- `MODE=allowlist`: only listed wallets self-claim for enabled families.
- `MODE=on`: every wallet self-claims for enabled families.
- A family absent from `QUEST_SELF_CLAIM_FAMILIES` remains unchanged.

Keep `DAILY_SELF_CLAIM_MODE` compatibility until daily check-in is migrated to
the generic policy. If both are present, the generic family policy wins and a
startup warning records the deprecated setting without logging addresses.

For a wallet/family in self-claim mode, all legacy endpoints, old clients,
automatic check-in schedulers, admin callbacks, and webhook handlers must be
unable to enqueue the same logical reward. They return/record
`self-claim-required` or create a claimable intent as appropriate.

Before enabling a family:

1. stop its sponsored producer;
2. list pending/processing/failed mint jobs by logical idempotency key;
3. drain or conclusively cancel them;
4. reconcile completed jobs into completion tables;
5. make voucher issuance check the legacy job table;
6. test allowlisted wallets;
7. enable the family at a UTC scope boundary where applicable.

Never issue a voucher when the corresponding legacy job is pending or
processing. A completed job returns Already claimed. A failed job requires a
conclusive no-mint reconciliation before becoming eligible for self-claim.

Recommended order:

1. Refactor working daily check-in onto the generic engine with no behavior
   change.
2. Daily transfer/receive/count/Kiln quests.
3. Balance/game/top-up streaks and seven-day reward.
4. Direct partner and profile milestone quests.
5. Externally verified partner quests.
6. Platform bridge last, after webhook shadow testing.

## 11. Security requirements

- Keep `QUEST_VOUCHER_SIGNER_KEY` server-only with no `PRIVATE_KEY` fallback.
- Validate chain ID, contract code, `milesToken()`, `signer()`, and token minter
  authorization before every cached validation period.
- Require authentication before all eligibility or signer access.
- Derive the claimant exclusively from the session.
- Allowlist every claim family and fixed quest/tier combination server-side.
- Cap base and boosted points per claim and per wallet/day before signing.
- Rate limit by wallet and IP without blocking legitimate same-intent retries.
- Never log private keys or complete signatures.
- Store eligibility/finalizer payloads only from trusted server/provider data.
- Treat transaction hashes and intent IDs as untrusted, validate their shapes,
  and wallet-scope every lookup.
- Return indistinguishable not-found responses for another wallet's intent.
- Never treat RPC failure as `claimed = false`.
- Alert and fail closed on nonce collision or frozen-value mismatch.
- Because the deployed contract has no pause/cap, incident response is signer
  rotation and/or revoking the claimer's token minter role.

The shared signer increases blast radius. Production rollout requires a
dedicated voucher key, issuance-volume alerts, and a documented rotation
procedure before partner/Platform families are enabled.

## 12. Analytics and operations

Emit generic events with `family`, `quest_id`, `scope_key`, points, boosted,
wallet provider, and stage; never include signatures:

- `quest_self_claim_voucher_issued`
- `quest_self_claim_wallet_opened`
- `quest_self_claim_submitted`
- `quest_self_claim_confirmed`
- `quest_self_claim_retried`
- `quest_self_claim_failed`

Track:

- issuance-to-submission and submission-to-confirmation conversion;
- user rejection, insufficient-gas, revert, expiry, and stale rates;
- intents stuck in `chain_confirmed` finalization;
- nonce collisions/frozen-value mismatches;
- legacy mint jobs created after each family cutover;
- Akiba gas spent by claim-family idempotency prefixes;
- Platform rewards released but not yet claimed on Celo.

Alert immediately if a self-claim-enabled family creates a sponsored mint job.

## 13. Test plan

### Unit

- Generic nonces are deterministic and have the high bit set.
- Different quest IDs or scope keys produce different nonces.
- Daily check-in retains the legacy epoch-day nonce.
- Daily and ISO-week boundaries are correct at UTC/year boundaries.
- Signature recovery matches the configured signer for hashed nonces.
- Reward, boost, nonce, and finalizer remain frozen across retries.
- Deadline refresh changes only the signed deadline.
- Every registry family rejects unknown client-selected IDs/tiers.

### Intent/reconciliation

- Concurrent issuance returns one frozen intent/voucher.
- Unique `(wallet, nonce)` collision fails closed.
- One wallet can claim several quests on the same day.
- The same quest/scope can be claimed independently by different wallets.
- Rejection, revert, drop, expiry, replacement, and RPC outage follow §6.
- Wrong sender, destination, event wallet, nonce, or amount cannot confirm.
- `claimed() = true` without a delivered hash recovers the correct finalizer.
- Concurrent confirm/status/sweep calls cannot move state backward.
- A chain-confirmed finalizer failure retries without another mint.
- Invalid/cross-wallet intent IDs never fall back to an unrelated intent.

### Domain finalizers

- Daily completion is inserted exactly once.
- Streak increments once under concurrent finalization and only after mint.
- Weekly claims use the correct ISO week.
- Partner once-ever/weekly rows and canonical delivery complete exactly once.
- Profile milestone flags are set only after confirmation.
- Platform webhook redelivery creates one intent and zero sponsored jobs while
  enabled.

### Legacy exclusion

- Every enabled legacy route produces no mint job for self-claim wallets.
- A pending/processing legacy job blocks voucher issuance.
- A completed legacy job returns Already claimed and repairs completion state.
- An RPC/database failure fails closed and does not fall back to sponsorship.
- Automatic daily scheduler and provider/admin callbacks respect family mode.

### Client

- Generic orchestration handles issued, submitted, confirmed, retryable,
  expired, and timeout states.
- Multiple pending quest intents survive reload without overwriting each other.
- Server pending-intent recovery works without localStorage.
- Wallet rejection does not mark completion.
- Wrong network and insufficient gas show actionable messages.
- Platform `preparing` transitions to voucher-ready without duplicate calls.

### Real-wallet rollout

For each family phase, test browser wallet and MiniPay:

1. claim two different quests on the same UTC day;
2. verify each exact balance delta and event nonce;
3. reject once and retry;
4. broadcast, close, reopen, and recover;
5. try a duplicate claim;
6. test the relevant UTC day/ISO-week boundary;
7. confirm no matching mint job was created and Akiba paid no gas.

## 14. Acceptance criteria

- Every included interactive quest can issue a server-authorized voucher for
  the existing Celo claimer.
- The user's authenticated wallet is the transaction sender and gas payer.
- Multiple different quest claims can succeed for one wallet on the same day.
- Existing daily check-in replay protection remains backward compatible.
- Eligibility and reward values remain server-controlled and frozen.
- Only a verified mint plus successful idempotent finalization marks a quest
  completed.
- Rejection/revert/drop/expiry does not incorrectly consume an open claim.
- Browser and cross-device recovery do not require another mint.
- Sponsored and self-claim paths cannot both pay the same logical completion.
- Platform webhook mode creates either a sponsored job or a self-claim intent,
  never both.
- Excluded automatic rewards continue operating unchanged.
- Typecheck, production build, focused tests, and the full existing suite pass
  except explicitly documented pre-existing failures.

## 15. Estimated implementation effort

| Workstream | Estimate |
|---|---:|
| Generic nonce, intent schema, signer/config/refactor | 2–3 engineer days |
| Daily challenge routes and generic client orchestration | 2–3 days |
| Streak finalizer/auth hardening | 1–2 days |
| Direct partner and profile milestones | 2–3 days |
| External partner and Platform webhook bridge | 3–5 days |
| Tests, migration rehearsal, observability, allowlist smoke tests | 3–4 days |

Expected total: **10–15 engineer days**, plus staged production observation.
The first useful phase—all Daily Challenge cards—should fit in **4–6 engineer
days** because it reuses the working daily check-in client and reconciliation
path. No Solidity development, audit, deployment, or minter transaction is
required.
