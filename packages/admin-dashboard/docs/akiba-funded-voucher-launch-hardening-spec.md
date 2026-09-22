# Akiba-Funded Vouchers — Admin and Hub Launch Hardening Specification

**Status:** Proposed implementation specification

**Owners:** MiniMiles Admin Dashboard, Akiba Hub

**Runtime dependency:** `Akiba-Platform/docs/akiba-funded-voucher-runtime-hardening-spec.md`

**Builds on:** `akiba-funded-voucher-admin-spec.md`

---

## 0. Decision

The existing Akiba-funded voucher implementation is suitable for product demos,
but it must not be enabled for real-money merchant reimbursements until the
financial-integrity and schema-compatibility gates in this specification and
its Akiba-Platform companion are complete.

This document finishes the MiniMiles-owned surfaces:

1. the Admin fund and merchant-allocation control plane;
2. the Finance reimbursement console;
3. direct member grants;
4. Hub discovery, eligibility presentation, claiming, and claimed-voucher UX;
5. feature flags, failure states, observability, and rollout controls.

The Platform remains authoritative for eligibility, budget availability,
issuance, redemption, payables, batching, reversals, and payment state.

---

## 1. Launch principles

1. **No UI-only financial rules.** The Admin may explain and preview a rule,
   but Platform RPCs must enforce it transactionally.
2. **No silent controls.** A constraint that is not enforced must be disabled,
   not shown as a working checkbox with a warning.
3. **No shared generic settlement view names.** Akiba-funded reimbursements use
   namespaced Platform views and RPCs and must not replace MiniMiles' legacy
   voucher settlement views.
4. **No mixed money units.** APIs exchange integer KES minor units. Components
   may format KES for display but never perform financial aggregation.
5. **No Miles-purchase fallback.** Akiba-funded templates are acquired only by
   the funded claim/grant path and never by a zero-Miles catalog purchase.
6. **Fail closed by section.** If Platform funded-voucher APIs are unavailable,
   hide or error the funded section without breaking ordinary Hub rewards.
7. **Every economic action is attributable.** Approval, budget changes,
   batching, payment, reversal, and incident resolution require a real operator
   identity and an audit reason where specified.

---

## 2. Shared contract and terminology

### 2.1 Canonical lifecycle states

Admin and Platform must use these exact states:

| Object | States |
|---|---|
| Fund | `draft`, `pending_approval`, `approved`, `scheduled`, `active`, `paused`, `ended`, `cancelled` |
| Allocation | `draft`, `pending_approval`, `approved`, `scheduled`, `active`, `paused`, `exhausted`, `ended` |
| Voucher | `issued`, `redeemed`, `expired`, `revoked` |
| Reimbursement batch | `draft`, `submitted`, `paid`, `cancelled` |
| Reconciliation incident | `open`, `resolved` |

The Admin reimbursement UI must not translate these into the legacy
`approved`/`processing`/`failed` settlement workflow.

### 2.2 Canonical money fields

All Admin API payloads use integer minor-unit fields:

- `authorizedBudgetMinor`
- `allocatedBudgetMinor`
- `reservedMinor`
- `realizedMinor`
- `outstandingMinor`
- `batchedMinor`
- `paidMinor`
- `availableMinor`

The UI may accept a KES decimal input and convert once at its server boundary.
Floating-point values must not be sent to Platform settlement RPCs.

### 2.3 Namespaced Platform reporting views

The Admin funded-voucher Finance surface reads only:

- `v_akiba_voucher_unbatched_payables`
- `v_akiba_voucher_merchant_balances`
- `v_akiba_voucher_reimbursement_batches`
- `v_akiba_voucher_open_reconciliation_incidents`

These names are intentionally distinct from the legacy MiniMiles views:

- `v_unbatched_voucher_payables`
- `v_partner_voucher_payable_balances`
- `v_partner_settlement_batches`
- `v_open_voucher_reconciliation_incidents`

No Platform migration may drop or replace the legacy views.

---

## 3. Feature flags

Add server-side flags with production defaults of `false`:

| Flag | Effect |
|---|---|
| `AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED` | Shows fund/allocation/grant navigation and enables mutations |
| `AKIBA_FUNDED_VOUCHERS_HUB_ENABLED` | Shows funded offers and permits Hub claim proxy calls |
| `AKIBA_FUNDED_VOUCHERS_FINANCE_ENABLED` | Enables batching, submission, payment, reversal, and incident actions |

Read-only detail pages may remain accessible to authorized operators when a
mutation flag is off. Mutation APIs must enforce flags server-side; hiding a
button is not sufficient.

Funded-voucher mutations must refuse to start when `ADMIN_OPEN_ACCESS=true` in
production. A real `admin_users.id` is required for every economic mutation;
the zero UUID or an `open-access` text actor is never valid in production.

The kill switch must stop new claims and grants without invalidating vouchers
already issued. Platform pause/end controls remain the authoritative inventory
controls.

---

## 4. Admin fund and allocation polish

### 4.1 Fund summary

The fund detail page must show:

- authorized budget;
- budget allocated to approved/live merchant allocations;
- active voucher reservations;
- realized redemption cost;
- reimbursed/paid amount;
- unallocated available budget;
- claim, redemption, expiry, and reimbursement counts;
- latest approval revision and approver;
- start/end dates and country.

The UI must use Platform-calculated values. It must not sum allocation rows in
JavaScript as its source of truth.

### 4.2 Allocation summary

Each allocation shows:

- merchant and country;
- exact KES discount and minimum spend;
- quantity cap, claimed, issued, redeemed, expired, and remaining;
- allocation authorization, reserved, realized, and unused amounts;
- claim window and voucher-validity window;
- distribution modes;
- eligibility rule-set version and customer-facing copy;
- state, version, and last transition actor.

### 4.3 Approval and maker-checker

- Ops may draft and submit.
- Finance may approve or reject.
- Ops may publish an approved allocation.
- Finance may adjust an approved financial commitment.
- Above the configured maker-checker threshold, the creator may not approve
  the same fund or mark their own reimbursement batch paid.
- `super_admin` override requires a reason and is visibly marked in audit data.
- A stale version/revision returns `409` and prompts the operator to reload.

### 4.4 Budget presentation

Before approval, show the maximum commitment explicitly:

```text
10 vouchers × KES 500 maximum reimbursement = KES 5,000
```

Also show the parent fund's unallocated amount after approval. Disable approval
when the Platform preview reports insufficient parent budget, but still rely on
the approval RPC for the final atomic check.

### 4.5 Eligibility editor

Use structured rule editors only. The following rules are supported after the
Platform hardening dependency is deployed:

| Rule | Required configuration |
|---|---|
| `country_in` | ISO-2 countries and accepted assurance levels |
| `pass_activated` | None |
| `profile_country_set` | None |
| `minimum_account_age_days` | Positive day count |
| `verified_activity_completed` | Registered verification template key |
| `first_funded_voucher` | Explicit scope: `program` or `global` |
| `no_prior_merchant_redemption` | None |
| `fund_claim_cooldown` | Positive days and explicit scope: `program` or `global` |
| `not_blocked` | None; requires the Platform restriction source to be live |

Until `not_blocked` is backed by the Platform restriction table, it must be
disabled and rejected by Admin validation. A warning that it “does nothing” is
not sufficient.

The editor must describe whether **all** or **any** rules are required and show
the exact customer-facing requirement copy before publication.

---

## 5. Direct member grants

Replace the placeholder `/vouchers/grants` page with a real operator workflow.

### 5.1 Permissions

- Viewing/searching requires `voucher_funds.read`.
- Issuing requires `voucher_funds.grant`.
- The API must recheck the permission server-side.

### 5.2 Flow

1. Search by email, wallet address, or canonical member ID.
2. Return masked identity results and canonical resolution state.
3. Select an allocation that allows `internal_grant` and is currently grantable.
4. Request an eligibility preview from Platform.
5. Display satisfied and missing requirements without exposing internal risk
   notes.
6. Require an operator reason of at least four characters.
7. Submit to Platform's internal grant endpoint with an idempotency key.
8. Show the issued voucher ID, expiry, merchant, and audit reference.

Platform contracts used by this flow:

- `POST /api/v1/internal/voucher-funding-allocations/:id/eligibility-preview`
- `POST /api/v1/internal/voucher-funding-allocations/:id/grants`

### 5.3 Grant idempotency

The Admin API generates a deterministic key for a deliberate grant attempt:

```text
admin-grant:<allocation-id>:<canonical-id>:<operator-confirmation-id>
```

Refreshing a completed response must replay it. A new grant confirmation ID
does not bypass the one-member-per-allocation rule.

### 5.4 Failure behavior

Map Platform errors to actionable operator copy:

- member not found;
- identity conflict;
- allocation not grantable;
- eligibility requirements not met;
- already claimed;
- quantity exhausted;
- allocation or parent budget exhausted;
- merchant unavailable.

---

## 6. Funded-voucher Finance console

Create a funded-voucher reimbursement API and UI independent of the legacy
settlement console.

### 6.1 Admin API

Use `/api/admin/voucher-reimbursements`.

`GET` returns:

```ts
type VoucherReimbursementDashboard = {
  balances: Array<{
    merchantId: string;
    merchantName: string;
    currency: "KES";
    outstandingMinor: number;
    batchedMinor: number;
    paidMinor: number;
    payoutReady: boolean;
  }>;
  unbatched: Array<{
    voucherRedemptionId: string;
    merchantId: string;
    receiptReference: string;
    redeemedAt: string;
    amountMinor: number;
    payoutReady: boolean;
  }>;
  batches: Array<{
    batchId: string;
    merchantId: string;
    state: "draft" | "submitted" | "paid" | "cancelled";
    itemCount: number;
    totalAmountMinor: number;
    paymentReference: string | null;
    paymentEvidenceRef: string | null;
    createdBy: string;
    submittedAt: string | null;
    paidAt: string | null;
  }>;
  incidents: Array<{
    incidentId: string;
    incidentType: string;
    severity: "info" | "warning" | "critical";
    entityType: string;
    entityId: string;
    openedAt: string;
  }>;
};
```

`POST` accepts exactly these actions:

- `create_batch`
- `submit_batch`
- `mark_paid`
- `cancel_batch`
- `reverse_redemption`
- `resolve_incident`

Each action maps to a namespaced Platform RPC. Do not call the legacy
`create_partner_settlement_batch` or `transition_partner_settlement_batch`
functions for Akiba-funded vouchers.

| Admin action | Platform RPC |
|---|---|
| `create_batch` | `create_voucher_reimbursement_batch_atomic` |
| `submit_batch`, `mark_paid`, `cancel_batch` | `transition_voucher_reimbursement_batch_atomic` |
| `reverse_redemption` | `reverse_akiba_funded_redemption_atomic` |
| `resolve_incident` | `resolve_voucher_funding_reconciliation_incident_atomic` |

### 6.2 Batch UX

- Only one merchant and `KES` may be selected per batch.
- Payables with `payoutReady=false` are visible but cannot be selected.
- Show receipt reference, redemption timestamp, and amount for every item.
- Submission locks the item set.
- Mark-paid requires Finance permission, payment reference, evidence reference,
  and confirmation of the exact total.
- A payment reference already used for the merchant is rejected.
- Cancellation requires a reason.
- Reversal controls show whether the payable is unbatched, draft-batched,
  submitted, or paid and follow the Platform transition rules.

### 6.3 Maker-checker for payment

At or above the configured payment threshold:

- the batch creator cannot mark the batch paid;
- a second Finance operator or super-admin override is required;
- the UI names the required control before submission;
- Platform remains the final enforcement point.

### 6.4 Legacy settlement isolation

The existing `/api/admin/settlements` and legacy Finance page remain unchanged
for legacy voucher liabilities. The new reimbursement console gets its own
route, DTOs, components, and tests.

### 6.5 Trusted operator principal

Every Platform mutation receives a server-derived operator principal:

```ts
type VoucherFundingOperator = {
  source: "minimiles_admin";
  actorId: string;
  role: "ops_admin" | "finance_admin" | "super_admin";
};
```

The Admin server derives this from the validated Iron session and current
`admin_users` row. The browser cannot supply or override it. Audit and
maker-checker comparisons use the pair `(source, actorId)` so identities do not
collide with Platform `internal_users`.

---

## 7. Hub discovery and claim polish

### 7.1 Canonical discovery source

Move funded-offer discovery from direct table reads to Platform's public
`GET /api/v1/voucher-funding-allocations` contract once the expanded response
is deployed. This prevents Hub and Platform filters from drifting.

Required card fields:

- allocation ID;
- merchant ID, name, slug, and image URL;
- title, KES discount, minimum spend, terms;
- sponsorship label;
- country code;
- claim end and voucher validity;
- customer-facing eligibility summary;
- for authenticated users: eligibility state, already-claimed state, and safe
  requirements remaining.

### 7.2 Offer visibility

- Anonymous users see active public offers and a sign-in CTA.
- Signed-in users do not see offers outside their resolved country.
- Eligible offers show `Claim this offer`.
- Ineligible offers caused by completable activity may be shown locked with
  customer-safe requirement copy.
- Blocked/manual-review decisions are never explained beyond “This offer is
  not available for this account.”
- Already-claimed offers link to the issued voucher.

Claim remains authoritative and re-evaluates eligibility.

### 7.3 Claim UX

The existing claim proxy pattern is retained:

- forward the member Supabase access token;
- use deterministic member/allocation idempotency;
- never accept eligibility facts from the browser;
- map `401`, `404`, `409`, `422`, and Platform availability failures to safe
  customer copy;
- refresh the active voucher list after success;
- prevent repeat clicks while the request is pending.

### 7.4 Claimed voucher UX

Funded vouchers in “My vouchers” and detail pages must show:

- `Funded by Akiba` sponsorship treatment;
- exact KES benefit and minimum spend;
- merchant and expiry;
- QR/code presentation using the existing secure presentation flow;
- no Miles cost or “free Miles purchase” language;
- redeemed, expired, and revoked states.

### 7.5 Isolation and resilience

If funded discovery fails, log a sanitized error and render ordinary rewards.
If claim fails after an uncertain network response, retry with the same
idempotency key and offer a refresh of “My vouchers.”

---

## 8. Zero-Miles acquisition guard

Hub Miles-purchase quote, issue, and redeem endpoints must reject a template
when any of the following is true:

- `managed_by = 'akiba'`;
- `funding_mode IN ('akiba_reimbursement', 'sponsor_reimbursement')`;
- `funding_allocation_id IS NOT NULL`;
- `miles_cost <= 0`.

This is defense in depth even when the availability RPC excludes funded
templates. Add route tests proving a funded template cannot be acquired through
the normal catalog flow.

---

## 9. Observability and audit

### 9.1 Required Admin audit events

- `voucher_fund.created|submitted|approved|rejected|published|paused|resumed|ended`
- `voucher_allocation.created|submitted|approved|rejected|published|paused|resumed|ended`
- `voucher_grant.succeeded|failed`
- `voucher_reimbursement_batch.created|submitted|paid|cancelled`
- `voucher_redemption.reversed`
- `voucher_reconciliation_incident.resolved`
- `voucher_finance.super_admin_override`

Audit metadata contains IDs, state changes, reason, amount minor units, and
request ID. Do not store raw email, wallet, bank details, or payment evidence
content in general audit metadata.

### 9.2 Operational indicators

Expose or log counters for:

- discovery and eligibility failures;
- claim success, rejection reason, and idempotent replay;
- reservations released by expiry;
- funded redemptions missing payables;
- unbatched payable age;
- submitted batch age;
- reversal-after-payment incidents;
- parent fund remaining balance.

---

## 10. Testing requirements

### 10.1 Admin

- permissions for every mutation;
- maker-checker approval and payment thresholds;
- stale version/revision handling;
- exact minor-unit conversions;
- legacy settlement routes remain unchanged;
- funded Finance DTOs match Platform view fields;
- payout-not-ready selection is blocked;
- direct grant success, replay, ineligible, exhausted, and identity-conflict cases;
- disabled rules cannot be submitted.

### 10.2 Hub

- Platform discovery mapping and failure isolation;
- anonymous, eligible, ineligible, wrong-country, already-claimed states;
- claim token forwarding and deterministic idempotency;
- uncertain network retry;
- KES display on list/detail/my-vouchers surfaces;
- funded templates rejected by all Miles-purchase endpoints;
- ordinary voucher catalog behavior remains unchanged.

### 10.3 Cross-repository contract

Add a fixture or generated TypeScript contract shared by tests so the Admin
dashboard fails CI if Platform changes funded reimbursement field names or
states. At minimum, commit the same JSON fixtures to both repositories and
compare them in CI.

---

## 11. Rollout

1. Deploy the Platform schema compatibility and financial-integrity migrations.
2. Run the Platform real-database suite against a clean database and a clone of
   the shared production schema.
3. Deploy Platform APIs with all feature flags off.
4. Deploy Admin and Hub readers with funded mutations off.
5. Verify legacy settlement views and existing voucher purchase flows.
6. Create a sandbox fund, one merchant allocation, and test members covering
   eligible and ineligible paths.
7. Exercise claim → redemption → payable → batch → submitted → paid and all
   reversal states.
8. Reconcile ledger, payable, merchant statement, and Admin totals exactly.
9. Enable Admin for named operators.
10. Enable Hub for an internal cohort, then founding merchants one at a time.

Rollback order:

1. disable new Hub claims;
2. pause active allocations;
3. keep redemption and reimbursement operational for issued vouchers;
4. disable Finance mutations only if payment safety is compromised;
5. never delete ledger, claim, redemption, payable, or batch records.

---

## 12. Definition of done

This MiniMiles work is launch-ready only when:

- Admin and Platform use the same namespaced reimbursement contract;
- legacy settlements still pass their existing integration suite;
- fund and allocation totals reconcile to Platform minor-unit values;
- direct grants are functional and audited;
- Hub discovery, eligibility presentation, claim, and claimed-voucher display
  work without direct schema drift;
- funded templates cannot enter the Miles-purchase flow;
- unenforced constraints cannot be selected;
- all Admin and Hub tests pass;
- the cross-repository end-to-end test passes against a real database;
- feature flags and rollback behavior are verified in a staging environment.
