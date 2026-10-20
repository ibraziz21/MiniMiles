# BDR-002 — Account deletion: bringing shared identity into native scope

**Status:** Accepted (implementation), pending the policy decision in §6
**Date:** 2026-10-19
**Decision owner:** Ibrahim
**Supersedes:** the exclusion recorded in `supabase/migrations/103_account_deletion_evidence.sql`
("shared account cleanup is outside native release scope")

---

## 1. Why this record exists

Migration 103 shipped account deletion with four of its twenty-one executable
steps declared but not implemented: `wallet_links`, `shared_profile_projection`,
`canonical_identity` and `auth_identity`. They had positions in `STEP_ORDER`,
and `canonical_identity` even had an executor registered, but its only body was:

```sql
WHEN 'canonical_identity' THEN
  RAISE EXCEPTION 'shared account cleanup is outside native release scope' USING ERRCODE='55000';
```

That was not an oversight. The migration says so twice — the `RAISE` above, and
a comment at the end of the file: *"Shared Auth/identity/ledger effects remain
outside this release pending review."* A third note in the `earning_events`
branch defers the canonical mapping to a later step on purpose.

Migration 105 reverses that exclusion. This record exists so that the next
person to ask "why does the native app's deletion reach into Platform's tables?"
finds the answer rather than re-deriving it — or worse, assumes it was never
considered.

## 2. Context at the time of the decision

### 2.1 The exclusion was about ownership, not blast radius

`identity_links` (50,730 rows) and `miles_ledger` (5,568 rows) exist in the same
Supabase project as everything else, but they are defined in **no migration in
this repository**. They belong to Akiba-Platform. Every other deletion target is
declared in `supabase/migrations/`.

That is the substantive cost of this decision, and it does not go away:
`accountDeletionStepOrder.test.ts` reads real migration SQL to verify foreign-key
ordering, so it is structurally blind to these two tables. A Platform-side schema
change can break the native deletion path with nothing in this repository failing.

### 2.2 Play requires in-app deletion, and the URL does not substitute

Google requires account deletion both in-app and via a web resource for any app
allowing account creation. `packages/akiba-app/docs/store-release/privacy-data-map.md`
previously recorded the public `/account-deletion` URL as "the honest answer for
the Data deletion field until the in-app flow accepts requests". That is wrong as
a compliance position, and it is why this work was prioritised.

### 2.3 Four of the four steps were required, not optional

`deletionAvailability()` refuses with `implementation_unverified` unless **every**
executable inventory row appears in `IMPLEMENTED_DELETION_STEPS`. Implementing
three of four would have changed nothing.

## 3. What was decided

Implement all four steps in migration 105, with these specific choices.

### 3.1 `canonical_identity` pseudonymizes by removing the mapping, not the key

`canonical_id` is `NOT NULL` on both `identity_links` and `miles_ledger`, so the
obvious reading of `pseudonymize` — blank the key — is unavailable.

Instead the step deletes `identity_links`, which holds the member's email and is
the only mapping from a canonical id to a real person. `miles_ledger` rows keep
their original `canonical_id`, which afterwards resolves to nobody. The ledger
survives intact as merchant-settlement evidence; the member is no longer
identifiable from it.

This is pseudonymization in the proper sense, and it is strictly better than the
alternative of deleting ledger rows, which would destroy evidence Akiba owes
merchants.

### 3.2 `auth_identity` releases its own proof row's reference, atomically

`account_deletion_requests.hub_user_id` references `auth.users`, and that row is
retained 24 months as proof the deletion happened. The auth user therefore cannot
be deleted while its own deletion record points at it.

Migration 103 line 24 already dropped that column's `NOT NULL` — the architecture
anticipated this moment. The step nulls the reference and deletes the auth user in
**one transaction**. Atomicity is a correctness requirement, not tidiness: losing
the user id between the two halves would strand the request with nothing left to
resolve it against, after every earlier step had already destroyed the data.

Done in SQL rather than via the Auth Admin API for that atomicity. The practical
difference is nil — `auth.identities`, `auth.sessions` and `auth.refresh_tokens`
cascade from Supabase's own constraints, and already-issued access tokens stay
valid until expiry under either route.

### 3.3 Shared canonicals are re-checked at processing time

Admission already refuses a canonical shared with another `hub_user_id`, or any
non-email `identity_links` row. The step checks again, because admission and
processing are separated in time and an identity merge can land in between.
Failing there is the correct outcome: it leaves the member's data intact.

## 4. What was rejected

**Deleting `miles_ledger` rows.** Destroys merchant-settlement evidence. See §3.1.

**A tombstone canonical id.** Repointing `miles_ledger.canonical_id` at a sentinel
would satisfy `NOT NULL` while severing identity, but it invents a concept the
schema does not have, and orphaning the real id achieves the same result with no
new vocabulary.

**Decoupling submission from processing** so the in-app path could accept requests
for manual fulfilment. This is a legitimate and cheaper route to Play compliance,
and it was considered. It was not taken here because the coupling exists to fix a
real bug documented at the top of `accountDeletionAvailability.ts`: an earlier
version returned 202, the pending-account guard locked the member out of every
protected route, and the worker then refused to process anything — members could
be shut out of accounts that would never be deleted. Any manual path must record
the request in a status outside `PENDING_DELETION_STATUSES` to avoid re-opening
that trap. It remains available as a faster alternative if the §6 decision stalls.

## 5. Consequences

- `DELETION_IMPLEMENTATION_VERSION` moves to `2026-10-19.2`, so
  `ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED` must be set to that exact string
  before deletion can be available.
- Guard 2 (`implementation_unverified`) can now be satisfied. Three of the four
  gates in `deletionAvailability()` become reachable.
- The native app's deletion path now mutates tables this repository does not
  define. §2.1 is the standing risk; the new test
  `does not pretend to have checked the shared Platform tables` fails loudly if
  those tables ever arrive here, as a prompt to drop the exemption.
- A new integration test covers the two claims mocks cannot
  (`src/__tests__/integration/accountDeletionSharedIdentity.test.ts`). It requires
  a dedicated `DELETION_INTEGRATION_DB_URL` and refuses to run against the
  production project ref.

## 6. What this does NOT unblock

**Deletion still refuses every request.** `account_deletion_preflight` seeds its
blocker array unconditionally:

```sql
DECLARE blockers text[] := ARRAY['shared_account_scope_review'];
```

The `preflight` step raises whenever that array is non-empty, so no deletion can
complete regardless of the work in this record. Removing that entry is the
shared-account scope review itself — a decision about whether native deletion may
act on cross-product identity — and it is deliberately left to its owner rather
than quietly deleted alongside the implementation.

Also still outstanding, and not addressed here:

- 18 of 23 retention inventory rows remain unapproved (`retention: null`), which
  is a separate gate.
- `ACCOUNT_DELETION_SUBMISSION_ENABLED`, `ACCOUNT_DELETION_PROCESSING_ENABLED`,
  `ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED` and `ACCOUNT_DELETION_EXPIRY_ENABLED`
  are all unset. The last two are absent from `.env.example` despite it
  describing itself as the canonical inventory.
