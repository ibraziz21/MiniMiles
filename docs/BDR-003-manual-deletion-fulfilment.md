# BDR-003 — Account deletion: manual fulfilment

**Superseded in part by [BDR-004](BDR-004-admin-shared-account-deletion.md):**
shared-account closure is now authorized, and Admin Dashboard verified cleanup
replaces the procedural completion function. The original acceptance/receipt
design below is historical context, not permission to mark a request complete.

**Status:** Accepted
**Date:** 2026-10-19
**Decision owner:** Ibrahim
**Relates to:** the native-only scope decision in
`packages/hub-page/docs/akiba-account-deletion-retention-decisions.md`
§"Scope steering", which this record deliberately does **not** change, and
[BDR-002](BDR-002-native-deletion-shared-identity-scope.md)

---

## 1. Why this record exists

Akiba's in-app deletion path refused every request. A member who tapped
Settings → Danger zone → Delete account reached a support fallback, and a Play
reviewer would have done the same.

Google requires account deletion both in-app and via a web resource for any app
that allows account creation. The public `/account-deletion` page works, but it
does not substitute for the in-app path. This was the single most likely cause
of a Play rejection.

The obvious fix — finish the automated pipeline — was not available, and this
record exists to explain why the less obvious fix was taken instead.

## 2. Context at the time of the decision

### 2.1 The refusal was deliberate, and correct

`account_deletion_preflight` seeds its blocker array unconditionally:

```sql
DECLARE blockers text[] := ARRAY['shared_account_scope_review'];
```

That encodes the scope decision of 2026-10-19: limit this release to
native-app data, and review shared-account effects first. `identity_links` and
`miles_ledger` belong to Akiba-Platform and are shared with other products, so
letting an unsupervised worker act on them was reasonably judged premature.

The blocker also reaches request *creation*, because
`create_account_deletion_request` refuses while the preflight is non-empty. So
the scope decision closed the in-app path as a side effect, not by intent.

### 2.2 Implementing the missing steps did not help

[BDR-002](BDR-002-native-deletion-shared-identity-scope.md) implemented the
four shared-identity steps the earlier migration had left out. Necessary work,
and it satisfied one of `deletionAvailability()`'s four gates — but the
preflight refuses before any step runs, so deletion still completed nothing.

### 2.3 Google does not require automation

From Play's own account-deletion guidance, the flow *"does not have to be an
app where they can login and request the deletion automatically; it can be a
simple form where they can request the deletion and you can get back to them
later."*

That is the gap this uses. The requirement is a working request path, not an
automated one.

### 2.4 There is a known trap in accepting requests

`accountDeletionAvailability.ts` documents a bug that was already fixed once:
an earlier build returned 202, the pending-account guard immediately locked the
member out of every protected route, and the worker then refused to process
anything. Members could be shut out of accounts that would never be deleted.
Acceptance was therefore bound to processing.

Any manual path has to avoid re-opening that, which is the main constraint on
the design below.

## 3. What was decided

A third fulfilment mode: a verified, member-initiated request, recorded for a
person to carry out.

### 3.1 `manual_review` is a new status, not a reuse of `requested`

It sits outside `PENDING_DELETION_STATUSES`, so the pending-account guard does
not lock the member out, and outside the claimable index
(`WHERE status IN ('requested','failed')`), so the automated worker never picks
it up. Those two exclusions are the whole reason for a new status rather than a
flag on an existing one.

The member keeps access while they wait. That is deliberate: a person may take
days, and an account frozen for days with nothing processing it is precisely
§2.4's bug.

### 3.2 The guard's two jobs are now separate

`findOpenDeletionRequest` decides access. `findDeletionReceipt` decides what
the member is shown and what a retry resolves to. They differ by exactly
`manual_review`.

Without that split, a member retrying a submission would miss their own
request, be sent back through the challenge, and find the code already spent.

### 3.3 The manual creator skips only the preflight

`create_manual_account_deletion_request` calls
`create_account_deletion_request_v097` directly. The gate it bypasses exists to
stop a request the *worker* cannot carry out; no worker is involved here. Every
other check — challenge ownership, expiry, consumption, one-open-request —
is the same code.

Vouchers are still voided at request time, because v097 inserts `requested` and
`revoke_deleted_member_access` fires. That is the documented consequence of
asking to delete (legal copy §9) and is kept. The move to `manual_review`
happens in the same transaction, so no observer sees the pending status.

### 3.4 Manual never overrides automated

`deletionFulfilmentMode()` returns `automated` whenever the worker can run, and
only considers `manual` once it cannot. It also still requires
`ACCOUNT_DELETION_SUBMISSION_ENABLED`, so that remains the single kill switch —
enabling manual fulfilment must not reopen a path an operator closed during an
incident.

### 3.5 The app says so

The confirmation screen states that a person completes the request by hand,
that it is not instant, that vouchers stop working immediately, and that the
member can keep using the app until it is done. All four are true and the
member would otherwise be left wondering why they can still sign in.

## 4. What was rejected

**Removing the preflight tripwire.** That is the scope review itself — a
decision about whether native deletion may act on cross-product identity. It
belongs to its owner, not to a migration whose goal is Play compliance.

**Reusing `requested` with a side flag.** Would have put the row inside the
pending statuses and the claimable index, re-opening §2.4's lockout and
exposing the row to a worker that must not touch it.

**Soft-deleting the account instead.** Play is explicit that deactivating,
disabling or freezing does not qualify as deletion.

## 5. Consequences, and the cost

**`complete_manual_account_deletion_request` records a completion; it does not
perform one.** Calling it without having actually removed the member's data
tells them their account is gone when it is not. Under automation that
guarantee is technical. Here it is procedural, and that is the real price of
this decision.

Two things follow, and neither is optional:

- **The queue needs a named owner.** `account_deletion_manual_queue` exposes
  `overdue` and `days_outstanding` against a 14-day target. Nothing escalates
  on its own.
- **`ACCOUNT_DELETION_MANUAL_FULFILMENT_ENABLED` must not be switched on before
  that owner exists.** The flag is what starts telling members their deletion
  is coming.

Also:

- The member keeps account access between request and completion (§3.1), which
  differs from the automated path and is stated in the app.
- `manual_review` had to be added to the app's `deletionRequestStatusSchema`.
  Omitting it would have made the app reject its own successful receipt — the
  request lands, the parse fails, and the member sees an error for something
  that worked.
- This is a bridge, not a destination. When the shared-account scope review
  lands and the tripwire goes, the automated path takes precedence
  automatically by §3.4, and this mode can be switched off without a code
  change.
