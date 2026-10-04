# Akiba Vouchers — Web2 Username Identity Specification

**Status:** Proposed implementation specification

**Applies to:** Every voucher type, funding model, acquisition channel, presentation flow, redemption flow, and voucher-related notification

**Owners:** Akiba Hub, MiniMiles Admin Dashboard, Merchant Dashboard, Akiba-Platform

---

## 0. Decision

All Akiba vouchers are Web2 account assets.

The public identity used to find or display a voucher recipient is the member's
Akiba `@username`. The durable authorization and ownership key is the immutable
`hub_user_id` resolved from that username or from the authenticated Hub session.

```text
public recipient identity = normalized Akiba @username
durable voucher owner     = authenticated/resolved hub_user_id
```

A username is a lookup and display handle. It must never be stored as the sole
ownership key because usernames can change. A username change must not transfer,
hide, invalidate, or duplicate a voucher.

Wallets are outside the voucher identity and payment model. No voucher flow may
require or use:

- a connected wallet;
- a linked or verified wallet;
- a wallet address supplied by a member, merchant, or operator;
- a wallet signature;
- a wallet token balance;
- an on-chain burn or transfer;
- wallet-derived country, ownership, eligibility, cooldown, or uniqueness;
- a wallet fallback when username or Hub identity resolution fails.

This supersedes legacy voucher behavior that treats `user_address` as an owner,
recipient, identity fallback, purchase funding source, or raffle-delivery key.

Merchant reimbursement rails are a separate finance concern. A merchant may be
paid through M-Pesa, bank, manual settlement, or another approved rail, but the
rail must not affect customer voucher ownership, eligibility, or redemption.

---

## 1. Goals

- Make every voucher usable by a normal Hub member without a wallet.
- Use `@username` everywhere an operator or merchant identifies a recipient.
- Use `hub_user_id` for every ownership and authorization decision.
- Give self-claims, purchases, grants, automatic awards, presentation, and
  redemption one identity model.
- Remove wallet and chain availability from voucher reliability.
- Preserve existing vouchers through a controlled one-time ownership migration.
- Prevent username changes from changing historical or current ownership.
- Keep wallet and blockchain features elsewhere in Akiba independent from the
  voucher subsystem.

## 2. Non-goals

- Removing wallets from unrelated Akiba products.
- Defining merchant reimbursement provider implementation.
- Making a username itself an authentication credential.
- Exposing `hub_user_id`, email, phone, or canonical identity to merchants.
- Allowing unauthenticated username-only voucher claims.
- Replacing voucher QR presentation with a typed username at checkout.

---

## 3. Normative identity model

### 3.1 Canonical fields

| Field | Purpose | May authorize ownership? |
|---|---|---:|
| `username` | Public input and display label | No |
| `username_normalized` | Case-insensitive lookup key | No |
| `hub_user_id` | Immutable voucher owner and authorization key | Yes |
| `canonical_id` | Internal cross-system correlation and deduplication | No, not by itself |
| `user_address` / wallet | Legacy migration input only | No |

Every new `issued_vouchers` row must have a non-null `hub_user_id`. New voucher
rows must not populate `user_address`.

### 3.2 Username source of truth

The existing Akiba username registry is `leaderboard_profiles`, which provides:

- a case-insensitive unique username;
- a normalized lookup value;
- reserved-name controls;
- a username-change audit trail and cooldown;
- a stable `canonical_id` association.

Before vouchers depend on it, it must be promoted from a leaderboard-specific
concept to the canonical Akiba username service. Naming may be migrated later,
but there must be exactly one username source of truth.

The server-side resolver must perform this complete mapping:

```text
normalized username
  -> exactly one active username record
  -> canonical_id
  -> exactly one active hub_user_id
```

Zero matches return `USERNAME_NOT_FOUND`. An ambiguous or incomplete identity
link returns `USERNAME_IDENTITY_UNAVAILABLE`. Neither condition may fall back to
email, phone, or wallet.

### 3.3 Username normalization

All username inputs:

1. trim surrounding whitespace;
2. remove at most one leading `@`;
3. lowercase;
4. validate against `^[a-z0-9_]{3,20}$`;
5. resolve server-side through the canonical username registry.

Clients must never submit or choose `hub_user_id`, `canonical_id`, email, phone,
or wallet as an alternative recipient field in voucher interfaces.

### 3.4 Authenticated self-service

For self-claims and purchases, the authenticated Hub session determines
`hub_user_id`. The server then verifies that the member has an active Akiba
username before acquisition.

The client-supplied username is never trusted to choose the owner. If a username
is sent for display or confirmation, it must resolve back to the authenticated
`hub_user_id` or the request fails with `USERNAME_IDENTITY_MISMATCH`.

### 3.5 Grants and automatic awards

Admin and merchant grant interfaces accept `recipient_username` only. The API
normalizes and resolves the username to `hub_user_id` before evaluating
eligibility or beginning the atomic issuance transaction.

Automatic awards must already have a Hub user owner. An external event keyed by
a wallet, email, phone, or third-party identifier may not issue a voucher until
the producing system has linked the event to an authenticated Hub account with
an active Akiba username. That linking happens outside the voucher engine.

### 3.6 Username changes

Issued vouchers remain owned by `hub_user_id`. A username change:

- changes the current display label;
- does not update the owner key;
- does not reset claim limits or cooldowns;
- does not create a second claim entitlement;
- does not change idempotency keys;
- does not affect presentation or redemption.

Claims and audit records store `username_at_claim` as evidence. This snapshot is
for audit and display only and must not be used for later authorization.

---

## 4. Required behavior by voucher flow

| Flow | Public identity | Durable identity | Wallet behavior |
|---|---|---|---|
| Funded self-claim | Signed-in member's `@username` | Session `hub_user_id` | Never read |
| Loyalty/free claim | Signed-in member's `@username` | Session `hub_user_id` | Never read |
| Miles voucher purchase | Signed-in member's `@username` | Session `hub_user_id`; off-chain ledger only | Never read or connect |
| Admin grant | Operator enters `@username` | Resolved `hub_user_id` | No address field or fallback |
| Merchant grant | Merchant enters/scans `@username` identity | Resolved `hub_user_id` | No address field or fallback |
| Automatic award | Current username displayed | Pre-resolved `hub_user_id` | Source event cannot become owner |
| Raffle voucher | Winner's Akiba username/account | Resolved `hub_user_id` | No wallet-winner claim path |
| My vouchers/detail | Current signed-in username | Session `hub_user_id` | No legacy wallet lookup |
| QR presentation | Signed-in member | Session `hub_user_id` | No wallet ownership fallback |
| Merchant redemption | Short-lived voucher token | Voucher's `hub_user_id` remains owner | Customer wallet never requested |
| Notifications/support | Current and claim-time username | Voucher `hub_user_id` | Never display or search by wallet |

### 4.1 Miles purchases

Voucher purchases may spend only the member's Web2/off-chain Miles ledger.
`onchain_points`, wallet quotes, burn jobs, wallet signatures, and split
ledger/on-chain voucher purchases are not supported.

Insufficient ledger balance returns `INSUFFICIENT_MILES`; it must not prompt the
member to connect a wallet to cover a remainder.

### 4.2 Raffles and external campaigns

A voucher raffle must select or resolve a Hub account, not a wallet address. If
an existing on-chain raffle remains elsewhere in Akiba, its prize cannot be an
Akiba voucher unless the winner has independently bound the win to their Hub
account before voucher issuance. The voucher API receives only `hub_user_id` and
the username snapshot.

### 4.3 Presentation and redemption

Voucher presentation authorization compares the authenticated `hub_user_id`
with `issued_vouchers.hub_user_id`. Presentation RPCs must not accept arrays of
wallet addresses.

Merchant redemption continues to use a short-lived, single-use voucher token.
The customer does not type a username or connect a wallet at checkout.

---

## 5. API contracts

### 5.1 Username resolution

Provide one internal resolver used by Admin, Merchant, Hub, and Platform:

```ts
resolveVoucherRecipientUsername(username: string): Promise<{
  username: string;          // canonical current display value
  usernameNormalized: string;
  hubUserId: string;
  canonicalId: string;
}>;
```

The resolver is server-only, rate-limited, audited for privileged lookups, and
must not return email, phone, wallet, or unrelated profile fields.

Merchant-facing clients should receive an opaque, short-lived recipient
reference after username resolution. The final server route resolves that
reference to `hub_user_id`; raw internal IDs must not be exposed to the till.

### 5.2 Acquisition RPCs

Every voucher issuance RPC must require:

```text
p_hub_user_id UUID NOT NULL
p_username_at_claim TEXT NOT NULL
```

They must remove or reject:

```text
p_user_address
p_recipient_address
p_wallet_addresses
p_wallet_address
```

The atomic function verifies that `p_username_at_claim` currently belongs to
`p_hub_user_id`. This check occurs in the same transaction as eligibility,
inventory reservation, and voucher issuance.

### 5.3 Grant endpoints

Request:

```json
{
  "recipient_username": "amina",
  "reason": "Founding merchant launch offer"
}
```

The API must not accept `recipient_hub_user_id`, `recipient_address`, email, or
phone from an operator-facing request. Idempotency is based on the resolved
`hub_user_id`, program/allocation, and grant intent—not the mutable username.

### 5.4 Response minimization

Voucher APIs may return the current username as display data. They must not
return wallet fields. Public and merchant responses must not return
`hub_user_id` or `canonical_id`.

---

## 6. Data-model changes

### 6.1 Issued vouchers

Target invariant:

```sql
ALTER TABLE issued_vouchers
  ALTER COLUMN hub_user_id SET NOT NULL;

ALTER TABLE issued_vouchers
  DROP COLUMN user_address;
```

Until the migration is complete, application code still treats
`user_address` as forbidden and writes it as `NULL`. The column must not appear
in new RPC signatures, RLS policies, ownership checks, events, or API payloads.

### 6.2 Claims and audit

Add immutable claim-time display evidence where absent:

```sql
ALTER TABLE voucher_claims
  ADD COLUMN IF NOT EXISTS username_at_claim text;
```

Equivalent acquisition records for ordinary Miles and loyalty vouchers must
capture the same snapshot. Audit events include `hub_user_id` internally and
`username_at_claim`, never a wallet address.

### 6.3 Purchase model

Voucher purchase quotes and intents retain only Web2 ledger fields. Remove
wallet address, `onchain_points`, signed transaction, burn transaction, and
chain-reconciliation state from the voucher purchase contract.

Generic Miles infrastructure may retain chain functionality for non-voucher
products, but voucher code must not call it.

### 6.4 Ownership policies

All voucher SELECT, UPDATE, presentation, revoke, and support-access policies
use `hub_user_id`. Expressions such as the following are prohibited:

```text
user_address IN linked_wallets
hub_user_id = current_user OR wallet_matches
COALESCE(hub_user_id, user_address)
```

---

## 7. Legacy migration

Wallet removal is a data migration, not just a frontend change.

1. Stop new wallet-owned issuance.
2. Backfill `hub_user_id` for rows that already have a valid Hub owner.
3. For wallet-only historical vouchers, perform a one-time offline mapping
   through verified legacy identity links.
4. If exactly one Hub user is found, set `hub_user_id` and record a migration
   audit event.
5. If no unique Hub user can be found, set a non-redeemable
   `identity_migration_required` state for manual support resolution. Do not
   continue authorizing the voucher through the wallet.
6. Remove wallet-based reads from Hub, Admin, Merchant, and Platform.
7. Make `hub_user_id` non-null.
8. Drop voucher wallet columns, wallet RPC parameters, wallet indexes, and
   voucher-specific chain jobs after the observation window.

The one-time migration may read legacy wallet links solely to convert old data.
No runtime voucher request may use those links after cutover.

---

## 8. Stable errors

| Code | Meaning |
|---|---|
| `USERNAME_REQUIRED` | Signed-in member has not created an Akiba username |
| `USERNAME_INVALID` | Input does not match the canonical format |
| `USERNAME_NOT_FOUND` | No active Akiba member has that username |
| `USERNAME_IDENTITY_UNAVAILABLE` | Username cannot resolve to exactly one active Hub user |
| `USERNAME_IDENTITY_MISMATCH` | Supplied username is not owned by the authenticated Hub user |
| `RECIPIENT_REFERENCE_EXPIRED` | Opaque merchant recipient reference is expired or invalid |
| `LEGACY_VOUCHER_IDENTITY_REQUIRED` | Historical voucher awaits ownership migration/support |
| `INSUFFICIENT_MILES` | Web2 Miles ledger balance is insufficient |

No voucher response should contain `NO_LINKED_WALLET`, `CONNECT_WALLET`,
`INVALID_WALLET_SIGNATURE`, or an equivalent wallet instruction.

---

## 9. Security and privacy

- A username is discoverable but is not authentication.
- Self-service ownership always comes from the authenticated session.
- Grant username lookup is rate-limited and returns generic not-found copy.
- Merchant lookup returns an opaque expiring reference, not internal identity.
- Username reassignment cannot move old vouchers because ownership is by Hub ID.
- Claim uniqueness and cooldowns are keyed by `hub_user_id` or canonical member,
  never username.
- Username snapshots are escaped as display text and never interpolated into
  database filters.
- Voucher logs and analytics must not add wallet addresses.

---

## 10. Testing requirements

### 10.1 Required positive tests

- A member with a username and no wallet can claim every supported voucher type.
- A member with a username and no wallet can buy a voucher using ledger Miles.
- Admin and merchant grants resolve `@username` and issue to the correct Hub ID.
- A username change leaves existing vouchers visible and redeemable.
- QR presentation and redemption work with no wallet records present.
- Funded KES vouchers apply country and minimum-spend rules without wallet data.

### 10.2 Required negative tests

- A wallet address cannot be submitted as a grant recipient.
- A linked wallet cannot authorize another user's voucher detail or QR.
- Insufficient ledger Miles never produces a wallet-connect prompt.
- Wallet-only raffle evidence cannot issue a voucher.
- A stale username cannot transfer ownership after a rename.
- Ambiguous username-to-Hub resolution fails closed.
- A username belonging to another session fails with identity mismatch.
- No new voucher row or voucher event contains a wallet address.

### 10.3 Repository guard

Add a CI check over voucher-owned routes, libraries, migrations, and tests that
rejects new references to:

```text
user_address
wallet_address
walletAddresses
recipient_address
verifyWalletSignature
onchain_points
burn_tx_hash
```

An explicit allowlist may cover the one-time legacy migration only.

---

## 11. Rollout sequence

1. Make Akiba username creation part of Hub onboarding and voucher readiness.
2. Introduce the shared server-side username-to-Hub resolver.
3. Convert funded claims, loyalty claims, and free claims to username snapshots
   plus `hub_user_id` ownership.
4. Replace Admin and Merchant recipient fields with `@username` lookup.
5. Convert Miles voucher purchases to off-chain ledger-only spending.
6. Replace wallet raffle delivery with Hub account delivery.
7. Convert presentation and detail authorization to Hub ID only.
8. Stop wallet-owned issuance and deploy telemetry for prohibited wallet paths.
9. Run the historical ownership migration and quarantine unresolved rows.
10. Remove wallet parameters and columns after reconciliation.

The cutover is incomplete while any voucher screen can ask for a wallet, any
voucher API accepts a wallet, or any voucher owner can be authorized by one.

---

## 12. Existing implementation to replace

The following current paths conflict with this specification:

- `packages/hub-page/src/app/api/shop/vouchers/issue/route.ts` requires a
  verified wallet and signature.
- `packages/hub-page/src/app/api/shop/vouchers/quote/route.ts` uses on-chain
  Miles when the ledger does not cover the purchase.
- `packages/hub-page/src/app/api/vouchers/raffle/route.ts` authorizes a winner
  by verified wallet.
- `issue_voucher_from_program` resolves a Hub recipient to a linked wallet and
  raises `NO_LINKED_WALLET`.
- Admin and Merchant legacy grant routes accept `recipient_address`.
- My-voucher, detail, status, and presentation paths query linked wallets as a
  legacy ownership fallback.
- Voucher event and redemption schemas retain wallet identity fields.

These are removal targets, not supported compatibility modes.

---

## 13. Definition of done

- Every new voucher has a non-null `hub_user_id` and no wallet identity.
- Every member-facing voucher flow works for an account with no wallet record.
- Every recipient-facing Admin and Merchant control uses `@username`.
- Every username input resolves server-side to exactly one Hub user.
- Username changes do not affect ownership, limits, or redemption.
- Voucher purchase uses only the Web2 Miles ledger.
- No voucher route asks for a connection, address, signature, or chain balance.
- No voucher policy or RPC authorizes through linked wallets.
- Wallet-only historical vouchers are migrated or quarantined.
- Voucher tests run with wallet tables empty and pass.
- The Kenya profile-country gate and other eligibility rules evaluate the
  resolved `hub_user_id`, never a wallet-derived identity.

