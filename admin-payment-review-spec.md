# Spec: MiniMiles Admin Subscription Payment Review

**Status:** Approved product contract; ready for implementation  
**Implementation repository:** `MiniMiles`  
**Primary surface:** `packages/admin-dashboard`  
**Shared schema owner:** `Akiba-Platform`  
**Companion merchant spec:** [Merchant Subscription Billing and NCBA Payments](merchant-subscription-billing-payments-spec.md)  
**Audience:** Finance operations, admin-dashboard engineering, platform engineering

## 0. Executive contract

MiniMiles Admin Dashboard provides the internal finance queue that verifies
merchant subscription payments sent to the Akiba Ecosystems Ltd NCBA account.
It consumes the invoices, payment attempts, evidence, and guarded transition
RPCs owned by Akiba Platform.

```text
merchant submits NCBA/M-Pesa payment reference
  -> payment appears in oldest-first finance review queue
  -> finance administrator claims and checks the attempt
  -> administrator confirms or rejects it
  -> shared database transaction updates payment + invoice + subscription
  -> merchant sees the result and receives a notification/receipt
```

The operational target is confirmation in less than one hour. Admin Dashboard
must make queue age and SLA breaches obvious.

## 1. Scope and repository boundary

Implement in:

- `MiniMiles/packages/admin-dashboard/src/app/(dashboard)/finance/subscriptions`;
- `MiniMiles/packages/admin-dashboard/src/app/api/admin/subscription-payments`;
- supporting components, types, and tests under `packages/admin-dashboard`.

Akiba Platform owns:

- plan and billing-term configuration;
- `partner_subscriptions` and usage periods;
- subscription invoices/line items;
- payment attempts and private evidence bucket;
- NCBA payment-destination configuration;
- state transition RPCs and financial invariants.

MiniMiles must not create duplicate billing tables in
`packages/admin-dashboard/sql`, duplicate pricing formulas, or update shared
financial rows directly. Any required shared schema change is made through an
Akiba Platform Supabase migration.

## 2. Goals

1. Give finance staff a fast, auditable, oldest-first payment review queue.
2. Confirm a valid NCBA/M-Pesa payment and activate/renew/change the intended
   subscription atomically.
3. Reject invalid, duplicate, mismatched, or unreadable submissions with a
   merchant-safe reason and allow resubmission.
4. Keep merchant subscription collections separate from merchant payouts.
5. Meet and measure the less-than-one-hour review target.
6. Prevent unauthorized, stale, duplicate, or concurrent decisions.

## 3. Non-goals

- Initiating outbound payouts to merchants.
- Editing the plan catalogue or recalculating invoice prices in MiniMiles.
- Automatically scraping or integrating an NCBA bank feed in phase one.
- Treating uploaded proof as proof that funds settled.
- Supporting partial payments, overpayments, credits-on-account, chargebacks,
  or refunds in phase one.
- Editing merchant usage counters from the admin UI.
- Deleting payment attempts, evidence, invoices, receipts, or audit history.

## 4. Navigation and information architecture

The existing **Finance** section currently processes outbound merchant payout
invoices. Preserve that surface and introduce a finance submenu:

- **Payouts** — existing outbound payout page;
- **Subscription Payments** — new inbound payment-review queue;
- **Voucher Settlements** — existing settlement surface.

Route:

```text
/finance/subscriptions
/finance/subscriptions/[paymentAttemptId]
```

Never label inbound subscription payments merely **Payouts** or mix them into
the payout invoice list.

## 5. Roles and permissions

Use the existing Admin Dashboard permissions.

| Capability | `super_admin` | `finance_admin` | `readonly` with `finance.read` | Other roles |
|---|---:|---:|---:|---:|
| View queue/detail/evidence | Yes | Yes | Yes | No unless granted `finance.read` |
| Start review | Yes | Yes | No | No |
| Confirm payment | Yes | Yes | No | No |
| Reject payment | Yes | Yes | No | No |
| Void/reissue invoice exception | Yes | No in phase one | No | No |

All mutation routes require `requireAdminSession("finance.write")` and must
still explicitly restrict decisions to `super_admin` or `finance_admin`.
Read routes use `finance.read`.

The browser never receives the Supabase service key. All evidence signing and
state changes happen in server routes.

## 6. Queue screen

### 6.1 KPI row

Show:

- **Awaiting review** count;
- **Oldest waiting** age;
- **Confirmed today** count and KES total;
- **Over SLA** count;
- **Rejected today** count.

SLA colors:

- under 45 minutes: neutral;
- 45–59 minutes: amber;
- 60 minutes or more: red;
- under review for 30 minutes without a decision: amber stale-review flag.

### 6.2 Default queue

Default to attempts in `submitted` or `under_review`, ordered by
`submitted_at ASC`. Do not prioritize larger payments over older payments.

Columns:

- age/SLA;
- merchant;
- invoice number and short payment reference;
- invoice type;
- plan and term;
- expected amount;
- submitted amount;
- payment method;
- payer/provider reference;
- payment date;
- reviewer/claim status;
- risk flags;
- action.

Risk flags include:

- amount mismatch;
- duplicate submitted or confirmed reference;
- currency not KES;
- invoice no longer payable;
- payment date outside a reasonable window;
- missing/unreadable evidence (informational because evidence is optional);
- attempt already being reviewed;
- merchant/invoice mismatch.

### 6.3 Filters and search

Support:

- attempt status;
- SLA state;
- payment method;
- invoice type;
- submitted-date range;
- merchant;
- reviewer;
- payer/provider reference;
- invoice/payment reference;
- exact amount range.

Search results remain tenant-safe only by internal authorization; merchant
financial data is never exposed through a public route.

### 6.4 Completed history

A separate history view includes confirmed and rejected attempts with filters,
decision timestamps, reviewer, decision reason, invoice, receipt, and audit
link. Completed records are immutable.

## 7. Review detail

The detail page is split into the following panels.

### 7.1 Merchant and subscription

- merchant name and partner ID;
- current subscription plan/status;
- requested plan/term/change;
- active branch count and branch snapshot;
- founding status snapshot;
- activation/renewal dates;
- link to the existing Admin Dashboard merchant detail page.

### 7.2 Invoice

- invoice number/type/status;
- created, issued, due, and grace deadline;
- service/usage period;
- plan and pricing version;
- line items;
- subtotal, discount, VAT KES 0, total, paid/balance;
- expected short payment reference;
- snapshotted NCBA destination;
- pending plan change or activation effect that confirmation will apply.

The admin UI displays invoice values; it does not recalculate them.

### 7.3 Merchant submission

- payment method;
- submitted amount and currency;
- payer/provider transaction reference;
- payment date/time;
- merchant note;
- submission timestamp and current age;
- proof preview/download when supplied;
- prior rejected/submitted attempts for the same invoice;
- other uses of the normalized provider reference.

Evidence is loaded through a short-lived signed URL created by an authorized
server route. Do not log or persist the signed URL.

### 7.4 Reconciliation checklist

Before enabling **Confirm payment**, require the reviewer to attest:

1. Funds are visible in the AKIBA ECOSYSTEMS LTD NCBA account.
2. Provider reference matches the bank/M-Pesa record.
3. Confirmed currency is KES.
4. Confirmed amount exactly equals the outstanding invoice balance.
5. The reference has not already confirmed another payment.
6. The invoice and intended subscription effect are correct.

The UI checklist is an operator aid; the server/RPC repeats all enforceable
checks and never trusts checkbox values as proof.

## 8. Review actions and state transitions

### 8.1 Start review

**Start review** atomically changes the attempt from `submitted` to
`under_review` and records:

- reviewer admin user ID;
- review start time;
- attempt version.

Another finance administrator can open the record read-only while it is
claimed. A stale claim older than 30 minutes may be taken over by a
`finance_admin` or `super_admin`; takeover requires a note and an audit event.

### 8.2 Confirm payment

Required decision fields:

- confirmed provider reference;
- confirmed amount;
- confirmed currency (`KES` only);
- bank settlement/payment date;
- internal evidence note;
- expected record version/idempotency key.

The server calls the Akiba-owned confirmation RPC. That transaction must:

1. lock payment attempt, invoice, and subscription rows;
2. validate the attempt is `under_review` and claimed by the actor, unless a
   super-admin override is explicitly recorded;
3. validate the invoice is payable;
4. normalize and enforce confirmed-reference uniqueness;
5. require exact KES amount equality in phase one;
6. mark the attempt `confirmed`;
7. mark the invoice `paid` and zero its balance;
8. generate an immutable receipt number;
9. atomically activate, renew, reactivate, or upgrade the subscription according
   to the invoice snapshot;
10. return the persisted transition result for idempotent retries.

The success screen shows the receipt number, subscription effect, new term,
next renewal, and next usage reset. The merchant notification is queued after
commit.

### 8.3 Reject payment attempt

Required:

- rejection code;
- merchant-safe message;
- internal note;
- expected record version.

Supported initial codes:

- `funds_not_found`;
- `amount_mismatch`;
- `duplicate_reference`;
- `wrong_destination`;
- `wrong_currency`;
- `reference_mismatch`;
- `unreadable_evidence`;
- `invoice_not_payable`;
- `other`.

Rejection marks only the attempt `rejected`. The invoice returns to `issued` or
remains `overdue`, and the merchant can submit a new attempt. Rejection never
activates, renews, suspends, or changes a plan.

Merchant-safe messages must not expose unrelated transactions, another
merchant, internal fraud heuristics, or admin identity.

### 8.4 Amount mismatch

Phase one does not support partial or excess allocation:

- underpayment: reject as `amount_mismatch`;
- overpayment: reject as `amount_mismatch` and escalate to finance operations;
- do not manually edit the submitted amount to make it match;
- do not mark an invoice paid while leaving an untracked balance/credit.

Only a super-admin may void/reissue an incorrect invoice, and must provide a
reason. The original invoice and attempts remain in history.

## 9. Admin API contract

Routes live in MiniMiles Admin Dashboard and use its server-side Supabase
client. List/detail reads may query the Akiba-owned views. Every mutation calls
an Akiba-owned guarded RPC.

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/admin/subscription-payments` | `finance.read` | Paginated queue/history with filters |
| GET | `/api/admin/subscription-payments/:id` | `finance.read` | Attempt, invoice, merchant, subscription, and prior-attempt detail |
| POST | `/api/admin/subscription-payments/:id/evidence-url` | `finance.read` | Short-lived signed evidence URL |
| POST | `/api/admin/subscription-payments/:id/start-review` | `finance.write` | Claim submitted attempt |
| POST | `/api/admin/subscription-payments/:id/take-over` | `finance.write` | Take over stale claim with reason |
| POST | `/api/admin/subscription-payments/:id/confirm` | `finance.write` | Confirm through atomic RPC |
| POST | `/api/admin/subscription-payments/:id/reject` | `finance.write` | Reject through atomic RPC |
| POST | `/api/admin/subscription-invoices/:id/void-reissue` | super-admin | Exceptional correction |
| GET | `/api/admin/subscription-receipts/:id` | `finance.read` | Render/download paid receipt |

### 9.1 Confirm request

```json
{
  "idempotencyKey": "payment-review:<attempt-id>:confirm",
  "expectedVersion": 3,
  "confirmedReference": "THT9K4ABC1",
  "confirmedAmount": "24000.00",
  "confirmedCurrency": "KES",
  "paymentDate": "2026-09-18T10:15:00+03:00",
  "evidenceNote": "Matched in NCBA account activity."
}
```

Money is serialized as a decimal string at API boundaries. The server parses
it into exact database numeric values.

### 9.2 Confirm success

```json
{
  "ok": true,
  "idempotent": false,
  "paymentAttemptId": "uuid",
  "invoiceId": "uuid",
  "invoiceStatus": "paid",
  "receiptNumber": "AKB-RCT-2026-000001",
  "subscription": {
    "status": "active",
    "plan": "standard",
    "billingPeriod": "annual",
    "termStart": "2026-09-18T10:20:00+03:00",
    "termEnd": "2027-09-18T10:20:00+03:00",
    "nextRenewalAt": "2027-09-18T10:20:00+03:00",
    "usagePeriodEnd": "2026-10-18T10:20:00+03:00"
  }
}
```

### 9.3 Conflict responses

Return `409` for:

- stale version or another reviewer already decided;
- attempt/invoice invalid state;
- duplicate confirmed reference;
- amount/currency mismatch;
- invoice replaced, voided, cancelled, or already paid inconsistently.

An idempotent replay of the same completed decision returns `200` with the
persisted result.

## 10. Audit requirements

Use the existing `writeAdminAuditLog()` mechanism after the database
transition commits. Required actions:

- `subscription_payment.review_started`;
- `subscription_payment.review_taken_over`;
- `subscription_payment.confirmed`;
- `subscription_payment.rejected`;
- `subscription_invoice.voided_reissued`.

Audit metadata includes:

- payment attempt, invoice, partner, and subscription IDs;
- previous/new states and expected version;
- submitted and confirmed amounts/currency;
- normalized reference hash or masked reference in general audit listings;
- rejection code;
- receipt number;
- resulting subscription plan/status/term;
- request/correlation ID and source IP where available.

Do not place evidence signed URLs, bank credentials, full uploaded documents,
or unrelated transaction data in audit metadata.

If writing the general `admin_audit_logs` row fails after the authoritative RPC
commits, log/alert the failure but do not roll back or repeat the financial
transition. The domain payment row must itself retain reviewer and decision
fields so the decision remains attributable.

## 11. Notifications and SLA operations

After a decision commits, enqueue an in-app merchant notification:

- confirmed: amount, invoice, receipt, and resulting plan/renewal;
- rejected: invoice and merchant-safe reason with **Submit another payment**;
- delayed review: no merchant action required unless finance requests it.

Email is best effort to verified merchant owners.

Queue monitoring:

- emit a warning at 45 minutes;
- mark SLA breached at 60 minutes;
- surface stale reviews at 30 minutes;
- show a persistent badge count in the Finance navigation;
- send an internal alert when any submission crosses 60 minutes;
- record submitted-to-review and submitted-to-decision durations.

The target metric is at least the percentage of payment submissions confirmed
or rejected within one hour, excluding periods where the merchant submission
is incomplete and explicitly awaiting merchant action.

## 12. Security and failure handling

- Re-run authorization in every route; hiding buttons is insufficient.
- Validate route IDs and request schemas; cap note lengths.
- Escape merchant text and file names.
- Evidence URLs expire in five minutes or less.
- Use content type and file signature checks before preview/download.
- Never trust client-supplied invoice totals, plan, merchant ID, or intended
  subscription effect.
- Require optimistic version and idempotency keys on decisions.
- Do not expose whether a duplicate reference belongs to another merchant.
- Decisions are append-only in effect; use reversal/correction workflows, not
  record deletion or direct edits.
- Notification or receipt-rendering failure cannot produce a second payment
  confirmation.

## 13. MiniMiles implementation map

Suggested files:

```text
packages/admin-dashboard/src/app/(dashboard)/finance/subscriptions/page.tsx
packages/admin-dashboard/src/app/(dashboard)/finance/subscriptions/[id]/page.tsx
packages/admin-dashboard/src/components/finance/SubscriptionPaymentQueue.tsx
packages/admin-dashboard/src/components/finance/SubscriptionPaymentReview.tsx
packages/admin-dashboard/src/app/api/admin/subscription-payments/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/evidence-url/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/start-review/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/take-over/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/confirm/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-payments/[id]/reject/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-invoices/[id]/void-reissue/route.ts
packages/admin-dashboard/src/app/api/admin/subscription-receipts/[id]/route.ts
```

Add the Subscription Payments child navigation under Finance in
`src/components/layout/Sidebar.tsx`. Reuse the existing `finance.read`,
`finance.write`, `requireAdminSession`, `adminIdForWrite`, and
`writeAdminAuditLog` foundations.

## 14. Acceptance criteria

1. A submitted merchant attempt appears in the queue without manual refresh
   after normal page navigation and is ordered by oldest submission first.
2. Queue age is amber at 45 minutes and red at 60 minutes.
3. Only finance admins and super-admins can start, take over, confirm, or reject
   a review.
4. Read-only finance users can inspect but see no enabled mutation controls.
5. Starting a review claims it atomically; concurrent claims produce one
   winner and a visible conflict for the other.
6. Confirm remains disabled until the reconciliation checklist and required
   fields are complete.
7. Server confirmation rejects non-KES, mismatched amount, invalid state,
   duplicate reference, or stale version even if the browser is bypassed.
8. One confirmation creates exactly one paid invoice, receipt, and subscription
   transition under retries/concurrency.
9. Rejection preserves the attempt, returns the invoice to a payable state, and
   gives the merchant a safe reason and resubmission path.
10. Evidence can be opened only by authorized finance readers through an
    expiring URL.
11. Every decision and takeover is attributable in both the domain record and
    admin audit log.
12. Inbound Subscription Payments remain separate from outbound Payouts and
    Voucher Settlements.
13. The MiniMiles implementation contains no copied subscription pricing
    constants or direct financial state updates.
14. Confirmation response shows the actual resulting plan, term, next renewal,
    and next usage reset returned by the shared RPC.

## 15. Required tests

- Queue list pagination, filter, order, and SLA-age tests.
- `finance.read`/`finance.write` role matrix tests.
- Unauthorized evidence URL and signed-URL expiry tests.
- Claim, concurrent claim, stale claim, and takeover tests.
- Exact KES amount and decimal serialization tests.
- Duplicate submitted/confirmed reference tests without cross-merchant data
  leakage.
- Confirmation state, optimistic version, idempotent retry, and concurrency
  tests.
- Activation, renewal, reactivation, and immediate-upgrade confirmation tests.
- Rejection-code validation, safe copy, invoice-state, and resubmission tests.
- Receipt authorization/rendering tests.
- Audit success and audit-write-failure-after-commit tests.
- Notification failure does not repeat or roll back confirmation.
- XSS/file-name/content-type validation for merchant notes and evidence.

