# Spec: User-Paid Daily Check-In Claims on Celo

**Package:** `packages/react-app`  
**Supporting packages:** `packages/hardhat`, `packages/backend`, `supabase`  
**Source reference:** `PVP-Games`, commit `68466d530e62146272246108a7ff10c8c224c4eb`  
**Status:** Ready for implementation

---

## Context

Daily check-in rewards currently enter `minipoint_mint_jobs`; the backend mint
worker later submits an AkibaMiles mint transaction and Akiba pays the gas. The
PvP branch implemented a signed-voucher path where the backend still decides
eligibility and reward size, but the user's wallet submits the mint transaction
through `DailyQuestClaimer` and pays its gas.

This spec restores that model for the **daily check-in quest only**, adapted to
the current app and hardened around transaction rejection, reconciliation,
current vault boosts, MiniPay sessions, and old-client behavior.

### Existing Celo deployment

The following state was read from Celo mainnet on 2026-09-12:

| Item | Value |
|---|---|
| Network | Celo mainnet (`chainId = 42220`) |
| `DailyQuestClaimer` | `0xa9e6adb52e74151553c140615a09119d501c75ce` |
| AkibaMiles V2 | `0xab93400000751fc17918940c202a66066885d628` |
| Claimer owner | `0x7d63d39d88eb0d8754111c706136f5bd7ae84403` |
| Current voucher signer | `0x7d63d39d88eb0d8754111c706136f5bd7ae84403` |
| Claimer registered as token minter | Yes |

The deployed contract is usable. A new deployment is not part of this spec.
Before production rollout, repeat every validation in §9; do not rely only on
the values recorded above.

## Goals

1. The user, not Akiba, submits and pays gas for the daily check-in reward.
2. Preserve today's authentication, blacklist, activity-gate, reward, vault
   boost, streak, history, and analytics behavior.
3. A rejected, reverted, dropped, or expired transaction must not consume the
   user's daily opportunity.
4. A successful on-chain claim must reconcile into `daily_engagements`, even if
   the browser closes before its confirmation request completes.
5. Old clients must not be able to continue enqueueing sponsored daily mints
   after the self-claim cutover.
6. Keep every other quest/reward on its current delivery path.

## Non-goals

- No migration of transfer, streak, partner, profile, referral, order, game, or
  vault rewards to self-claim.
- No Base deployment and no use of `BASE_DAILY_QUEST_CLAIMER_ADDRESS`.
- No change to AkibaMiles V2 token economics or permissions beyond an optional
  one-time voucher-signer rotation.
- No gas sponsorship, paymaster, relayer, or automatic fallback to an
  Akiba-paid transaction while self-claim is enabled.
- No contract upgrade. The Celo claimer is immutable and non-proxy.

## Decisions

1. **Reuse the deployed Celo claimer.** The newer Base deployment script and
   current Base-oriented contract file are not the integration target.
2. **Use a separate claim-intent table.** `daily_engagements` means a completed
   reward. It must not be populated when a voucher is merely issued.
3. **Freeze the reward at first issuance.** A retry returns a voucher for the
   same points, amount, day nonce, and deadline, even if the user's vault state
   changes later that day.
4. **On-chain state is the mint authority.** The contract's
   `claimed(user, dayNonce)` becomes true only if `milesToken.mint()` succeeds;
   it is therefore sufficient to recover a successful claim when the original
   transaction hash was never delivered to the API.
5. **No silent sponsored fallback.** Failure produces a retryable user-facing
   error. A server-side kill switch may deliberately return the app to the old
   queue during an incident, but this is an operator action.
6. **Server session determines the claimant.** The API accepts no wallet,
   quest ID, points, amount, nonce, or contract address from the client.

---

## 1. Contract interface and voucher

The app needs a minimal ABI matching the already-deployed Celo contract:

```solidity
function claim(
  uint256 amount,
  uint256 dayNonce,
  uint256 deadline,
  bytes signature
) external;

function claimed(address user, uint256 dayNonce) external view returns (bool);
function milesToken() external view returns (address);
function signer() external view returns (address);

event QuestClaimed(
  address indexed user,
  uint256 dayNonce,
  uint256 amount
);
```

EIP-712 domain:

```ts
{
  name: "DailyQuestClaimer",
  version: "1",
  chainId: 42220,
  verifyingContract: DAILY_QUEST_CLAIMER_ADDRESS,
}
```

Typed value:

```ts
QuestClaim: [
  { name: "user", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "dayNonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
]
```

- `user` is the authenticated session wallet.
- `amount` is frozen `pointsAwarded * 10^18`.
- `dayNonce` is `floor(current Unix time / 86400)`.
- `deadline` is the final second of that UTC day.
- Use bigint arithmetic throughout (`BigInt(points) * 10n ** 18n`).
- The signing key is server-only. Require `QUEST_VOUCHER_SIGNER_KEY`; do not
  silently fall back to the general-purpose `PRIVATE_KEY`.

Add the ABI and typed-data constants in one shared module, with server-only
signing code isolated from client-importable exports.

## 2. Data model

Add a new forward-only Supabase migration using the next available migration
number. Do not copy the PvP migration unchanged.

### `daily_quest_claim_intents`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, generated |
| `user_address` | `text` | Lowercase EVM address |
| `quest_id` | `uuid` | Daily check-in quest |
| `claim_date` | `date` | UTC date |
| `day_nonce` | `bigint` | UTC day used by the contract |
| `base_points` | `integer` | Unboosted reward |
| `points_awarded` | `integer` | Frozen final reward |
| `amount_wei` | `text` | Decimal uint256 string |
| `vault_boost` | `jsonb` | Frozen boost metadata |
| `deadline` | `bigint` | Voucher expiry timestamp |
| `status` | `text` | `issued`, `submitted`, `confirmed`, `expired` |
| `tx_hash` | `text` | Nullable transaction hash |
| `last_error` | `text` | Nullable reconciliation error |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Default `now()` |
| `confirmed_at` | `timestamptz` | Nullable |

Constraints and indexes:

- Unique `(user_address, quest_id, claim_date)`.
- Check `user_address` is lowercase `0x` plus 40 hex characters.
- Check `amount_wei` contains decimal digits only.
- Check `status` is one of the four values above.
- Index `(status, updated_at)` for reconciliation/operations.
- RLS enabled; no direct anonymous/authenticated client access. API routes use
  the existing server Supabase client.

Also add, with `IF NOT EXISTS`, `source text default 'backend'` and
`tx_hash text` to `daily_engagements`, plus the existing unique constraint on
`(user_address, quest_id, claimed_at)`. Backfill null `source` values to
`backend`.

An issued/submitted intent is not a completed engagement and must not affect
the active/completed quest tabs, streak calculations, or reward history.

## 3. Shared reward calculation

Move the current vault-aware reward computation out of its private location in
`lib/minipointQueue.ts` into a server-only helper used by both:

- the existing queue path; and
- the new voucher route.

The result remains:

```ts
{
  basePoints,
  awardedPoints,
  vaultBoost: {
    applied,
    multiplier,
    balanceUsdt?,
    minBalanceUsdt,
  }
}
```

Only a newly created intent calculates the reward. Retries load these frozen
values from the intent.

## 4. Voucher API

Add `POST /api/quests/daily/voucher`. It accepts no body fields.

Processing order:

1. Require the current authenticated session.
2. Require `DAILY_SELF_CLAIM_MODE` to be `allowlist` or `on`.
3. Resolve the session wallet, daily quest, UTC date and day nonce server-side.
4. Apply the current blacklist check.
5. Apply the current activity rule exactly:
   - MiniPay session: retain the current activity-gate exemption.
   - Other session: require `MIN_CELO_TX_COUNT`, hard-failing on RPC error.
6. Check `DailyQuestClaimer.claimed(wallet, dayNonce)`.
   - If true, idempotently reconcile the intent and `daily_engagements`, then
     return `code: "already"`.
7. Find or create the day's intent.
   - New: calculate/freeze reward and insert `status = "issued"`.
   - Existing `issued`: reuse it.
   - Existing `submitted`: attempt §6 reconciliation before returning a
     voucher or `status: "submitted"`.
   - Existing `confirmed`: return `code: "already"`.
8. Sign the frozen intent using EIP-712.
9. Return the voucher and display metadata.

Success response:

```json
{
  "success": true,
  "status": "issued",
  "contractAddress": "0x...",
  "amount": "10000000000000000000",
  "points": 10,
  "basePoints": 10,
  "vaultBoost": { "applied": false, "multiplier": 1, "minBalanceUsdt": 0.000001 },
  "dayNonce": "20708",
  "deadline": "1789257599",
  "signature": "0x..."
}
```

Expected non-success codes: `auth-required`, `self-claim-disabled`,
`insufficient-activity`, `blacklisted`, `already`, `submitted`,
`signer-not-configured`, and `chain-unavailable`.

Rate-limit voucher requests per authenticated wallet and IP. Rate limiting
must not prevent a legitimate same-day retry after wallet rejection.

## 5. Client transaction

Restore the PvP `claimDailyQuestOnchain` capability in the current
`Web3Context`, adapted to current conventions:

1. Require a connected wallet and Celo `chainId = 42220`.
2. Simulate/estimate `claim()` when supported so contract errors surface before
   the wallet prompt.
3. Submit `claim(amount, dayNonce, deadline, signature)` from the authenticated
   address.
4. Append `withCeloAttribution()` to the transaction data.
5. Return the transaction hash as soon as it is broadcast; confirmation and DB
   finalization belong to the reconciliation API.

The client must never accept a different claimant, reward amount, contract, or
nonce from UI state. It submits only the voucher returned by the API.

Wallet rejection, insufficient CELO, wrong network, expired voucher and
contract revert must be mapped to actionable messages. No failure invokes the
old sponsored endpoint automatically.

## 6. Submission and reconciliation API

Add `POST /api/quests/daily/confirm` with `{ "txHash": "0x..." }` and
`GET /api/quests/daily/claim-status`.

Both routes require a session and operate only on that session wallet's intent
for the current UTC day.

### POST behavior

1. Validate transaction-hash shape.
2. Store it on the intent and set `status = "submitted"`; this does not create
   a completed engagement.
3. Attempt immediate reconciliation.
4. Return `submitted` when the transaction is not yet confirmed, `confirmed`
   after finalization, or a retryable error if it reverted/was invalid.

### Reconciliation

For a mined transaction, verify all of the following before writing
`daily_engagements`:

- Receipt status is success.
- Transaction destination is the configured claimer.
- Transaction sender is the authenticated wallet.
- The receipt contains `QuestClaimed` from the configured claimer.
- Event `user`, `dayNonce`, and `amount` match the frozen intent.
- At least one confirmation is present.

On success, idempotently:

1. Upsert `daily_engagements` with the intent's wallet, quest, date and points,
   `source = "onchain"`, and the verified hash.
2. Mark the intent `confirmed`, set `confirmed_at`, clear `last_error`.

If the receipt reverted, reset the intent to `issued`, clear `tx_hash`, record
the error, and let the user retry while the voucher remains valid.

If no hash was recorded but `claimed(wallet, dayNonce)` is true, reconcile as
`source = "onchain_reconciled"` with a null hash. This is safe because the
deployed contract sets `claimed` and calls `mint` in one atomic transaction;
the state cannot remain true after a reverted mint.

The GET route performs the same reconciliation and returns `issued`,
`submitted`, `confirmed`, or `expired`. Voucher issuance also invokes this
logic for stale submitted intents, so closing the browser cannot orphan a
successful claim.

## 7. Daily challenge UI

Adapt `components/daily-challenge.tsx` without replacing newer quest behavior.
Only the daily check-in handler changes.

State/copy:

| State | UI |
|---|---|
| Eligibility check | “Checking your daily reward…” |
| Voucher issued | “Confirm the transaction in your wallet. You pay the network fee.” |
| Wallet rejected | “Transaction cancelled. You can try again today.” |
| Broadcast | Show shortened hash and “Confirming on Celo…” |
| Confirmed | “You claimed {points} AkibaMiles.” |
| Insufficient gas | “You need a small amount of CELO to claim this reward.” |
| Expired | “This voucher expired. Request today’s reward again.” |
| Already claimed | Existing already-claimed result |

After broadcast, POST the hash immediately and poll claim status with bounded
backoff until confirmed or the UI timeout is reached. A timeout is presented as
pending—not failed—with a retry/status-check action.

On confirmation, dispatch the existing balance and quest refresh events. The
daily card moves to Completed only after `daily_engagements` is finalized.
Do not create or poll a `minipoint_mint_jobs` entry for this daily check-in.
Mint-job UI remains intact for every other quest.

Add analytics:

- `daily_self_claim_voucher_issued{points, boosted, wallet_provider}`
- `daily_self_claim_wallet_opened{wallet_provider}`
- `daily_self_claim_submitted{tx_hash, wallet_provider}`
- `daily_self_claim_confirmed{points, boosted, confirmation_ms}`
- `daily_self_claim_failed{stage, reason, wallet_provider}`
- `daily_self_claim_retried{previous_status}`

Never send signatures or private keys to analytics.

## 8. Sponsored-path shutdown and compatibility

Introduce server-side `DAILY_SELF_CLAIM_MODE`:

- `off`: existing `/api/quests/daily` queue behavior.
- `allowlist`: voucher path only for configured wallets; queue remains for
  everyone else during smoke testing.
- `on`: voucher path for everyone.

When mode is `on`, `POST /api/quests/daily` must **not enqueue** a mint job. It
returns HTTP `409` with:

```json
{
  "success": false,
  "code": "self-claim-required",
  "message": "Update the app to claim this reward from your wallet."
}
```

This closes the sponsored path for cached/old frontend bundles. It is not
enough to change only the current client.

Before enabling `on`:

1. Disable `AUTO_DAILY_CHECKIN_ENABLED`; the experiment directly enqueues
   sponsored daily rewards.
2. Drain or explicitly account for existing daily-check-in mint jobs.
3. Cut over immediately after a UTC-day boundary where practical, so one day
   does not mix delivery mechanisms.
4. Verify no other scheduler or internal route creates the same daily job key.

The emergency rollback is setting mode to `off`, which deliberately restores
Akiba-paid queue minting. Revoking the claimer's minter permission is the
on-chain hard stop and should be reserved for a signer/contract incident.

## 9. Configuration

Required React app/server variables:

```dotenv
DAILY_SELF_CLAIM_MODE=off
DAILY_QUEST_CLAIMER_ADDRESS=0xa9e6adb52e74151553c140615a09119d501c75ce
QUEST_VOUCHER_SIGNER_KEY=<dedicated-server-only-key>
CELO_RPC_URL=<production-celo-rpc>
```

Optional allowlist configuration should use the project's existing feature
flag/allowlist convention if one exists at implementation time; do not expose
the signing key through a `NEXT_PUBLIC_` variable.

Before launch, rotate the contract signer to a dedicated voucher key if the
configured production key is currently the token-owner/general relayer key.
Confirm the new address on-chain after `setSigner`. Keep token ownership out of
the application runtime.

Validate configuration at server startup or first use:

- address syntax;
- RPC chain ID;
- non-empty code at claimer;
- `milesToken()` equals configured AkibaMiles V2;
- `signer()` equals the address derived from `QUEST_VOUCHER_SIGNER_KEY`;
- `AkibaMilesV2.minters(claimer)` is true.

If validation fails, voucher issuance fails closed. It does not enqueue a
sponsored mint unless an operator has changed mode to `off`.

## 10. Security requirements

- Never accept claim values from request JSON.
- Never expose the signing key to client code, logs, errors, or analytics.
- Use a dedicated signer with only voucher authority; keep token-owner custody
  separate.
- Enforce authentication, blacklist, eligibility and rate limits before signing.
- Verify on-chain state/event before recording a completed engagement.
- Treat a submitted hash as untrusted until reconciliation succeeds.
- Log signer/chain/config mismatches without logging secrets or signatures.
- Add an operational alert for abnormal voucher issuance volume, invalid
  signatures, repeated reverts, and submitted intents stale for more than ten
  minutes.
- The existing contract has no pause or amount ceiling. The server must cap
  `points_awarded` to a configured sane maximum before signing; an emergency
  response must rotate the signer and/or revoke the claimer as a token minter.

## 11. Implementation sequence

1. Restore the deployed Celo ABI/source provenance from the PvP commit without
   overwriting the current Base-oriented contract/deployment files.
2. Add the claim-intent and `daily_engagements` compatibility migration.
3. Extract and test shared vault-aware reward calculation.
4. Add contract configuration validation and EIP-712 signing helper.
5. Implement voucher, confirmation and status APIs.
6. Add the wallet write method and Celo attribution.
7. Adapt only the daily check-in portion of the current challenge UI.
8. Gate both the new and old endpoints with `DAILY_SELF_CLAIM_MODE`.
9. Add tests from §12.
10. Deploy with mode `off`, run configuration checks, then use `allowlist` for
    real-wallet testing.
11. Disable automatic/sponsored daily enqueueing, drain old jobs, and enable
    mode `on` at the selected UTC boundary.

Do not cherry-pick commit `68466d5` wholesale; it includes unrelated PvP/game
work and predates substantial changes to `Web3Context`, daily reward boosts,
auth behavior and mint-job UI.

## 12. Test plan

### Unit

- EIP-712 signature recovers the configured signer.
- Domain, claim type and 18-decimal conversion match the deployed contract.
- UTC nonce/deadline behavior immediately before and after midnight.
- Reward boost is computed once and frozen across retry.
- Error mapping for wallet rejection, wrong chain, insufficient gas, expiry,
  already claimed and invalid signature.

### API/integration

- Unauthenticated, blacklisted and ineligible sessions never receive vouchers.
- MiniPay retains its current activity-gate behavior.
- Concurrent first requests create one intent and return equivalent vouchers.
- Rejected/no-hash flow leaves the intent retryable.
- Pending receipt stays submitted and does not create `daily_engagements`.
- Reverted receipt resets to issued.
- Wrong sender, destination, event, amount or day nonce cannot confirm.
- Successful receipt creates exactly one engagement and confirms exactly once.
- `claimed = true` with a missing hash reconciles after browser loss.
- Mode `on` prevents the legacy endpoint from creating a mint job.
- Existing non-daily quests continue enqueueing and displaying status normally.

### Real-wallet smoke test

Run on Celo with one allowlisted browser wallet and one real MiniPay wallet:

1. Claim normally and verify the wallet pays the network fee.
2. Verify exact AkibaMiles balance delta and `QuestClaimed` event.
3. Reject once, then retry successfully.
4. Broadcast and close the app before confirmation; reopen and verify recovery.
5. Attempt a second same-day claim and confirm the contract rejects/prevents it.
6. Test across UTC midnight.

## 13. Observability and success criteria

Dashboard daily:

- vouchers issued;
- transactions submitted;
- transactions confirmed;
- wallet rejection rate;
- revert/expiry rate;
- median issue-to-confirm time;
- stale submitted intents;
- daily-check-in jobs inserted into `minipoint_mint_jobs` after cutover;
- Akiba gas spent on daily check-in transactions.

Launch is successful when, for seven consecutive days:

- at least 98% of submitted claims confirm or reconcile;
- no wallet receives more than one daily check-in reward per UTC day;
- zero daily-check-in mint jobs are created while mode is `on`;
- Akiba submits zero daily-check-in mint transactions;
- balance, completed-quest, streak and history views agree with confirmed
  on-chain claims;
- no material regression appears between MiniPay and browser-wallet completion.

## 14. Acceptance criteria

- An eligible user requests a server-signed voucher and submits `claim()` from
  their own wallet on Celo.
- The user pays the transaction fee; neither the React server nor mint worker
  submits that reward transaction.
- Reward points and vault boost match current production rules and are frozen
  for the day once issued.
- Rejection/revert/drop does not consume the daily opportunity.
- Only a verified successful contract claim creates `daily_engagements` and
  moves the quest to Completed.
- Browser closure after broadcast is automatically reconciled on return.
- Duplicate requests and transactions cannot mint twice.
- Legacy/cached clients cannot enqueue sponsored daily check-in jobs in mode
  `on`.
- Every other quest retains its existing queue behavior.
- Typecheck, unit tests and relevant integration tests pass.

## 15. Follow-up

If the daily rollout succeeds and Akiba wants users to pay gas for other
interactive rewards, follow `all-quests-self-claim-spec.md`. The deployed
contract does not enforce that `dayNonce` equals the current UTC day, so the
field can safely carry a namespace-separated deterministic claim nonce. Keep
the existing daily check-in epoch-day nonce unchanged and use high-bit hashed
nonces for every other quest. No new contract is required.
