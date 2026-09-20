# Akiba-Funded Voucher Administration Specification

**Status:** Proposed

**Primary surface:** `MiniMiles/packages/admin-dashboard`

**Canonical runtime:** `Akiba-Platform`

**Companion specification:** `Akiba-Platform/docs/akiba-funded-founding-merchant-vouchers-spec.md`

---

## 0. Executive decision

The MiniMiles admin dashboard is the internal control plane for Akiba-funded
merchant vouchers.

Authenticated Akiba operators can:

1. create a finite voucher fund;
2. add one or more merchant allocations to that fund;
3. set the exact voucher benefit and maximum quantity for each merchant;
4. define country, member, activity, schedule, and per-user eligibility;
5. request and record Finance approval for the maximum KES exposure;
6. publish, pause, resume, top up, or end an allocation;
7. issue a voucher directly to an eligible member when authorized;
8. monitor claims, redemptions, reserved exposure, payables, and reimbursements;
9. initiate and approve merchant reimbursement batches through the existing
   Finance surface.

The dashboard does not implement eligibility, issuance, redemption, budget, or
settlement rules itself. All mutations call authenticated Akiba-Platform APIs
or atomic database functions. Akiba-Platform is authoritative when the UI and
runtime disagree.

The founding-partner example is configurable, not hard-coded:

```text
Fund: Founding Partners Launch — Kenya
Default merchant allocation: 10 vouchers
Default benefit: KES 500 fixed discount
Example maximum exposure per merchant: 10 × KES 500 = KES 5,000
```

Akiba may override quantity, value, dates, and eligibility for each merchant.

## 1. Product boundary

### 1.1 What this feature controls

This feature controls **Akiba-funded voucher inventory**. It does not replace
normal merchant-created vouchers.

| Voucher class | Created by | Discount cost | Merchant edit access |
|---|---|---|---|
| Merchant-funded voucher | Merchant | Merchant | Merchant-managed |
| Akiba-funded voucher | Akiba operator | Akiba, up to approved commitment | Read-only to merchant |
| Sponsor-funded voucher | Future authorized operator | Named sponsor | Read-only unless explicitly delegated |

An Akiba-funded allocation must never be created through a merchant
self-service endpoint. Changing an existing merchant-funded voucher into an
Akiba-funded voucher is not allowed.

### 1.2 Cross-repository ownership

| Concern | Owner |
|---|---|
| Internal fund and allocation UI | MiniMiles admin dashboard |
| Admin authentication and admin audit trail | MiniMiles admin dashboard |
| Merchant, identity, voucher, and redemption data | Akiba-Platform / shared Supabase |
| Eligibility evaluation | Akiba-Platform verification runtime |
| Atomic claim and issuance | Akiba-Platform |
| Atomic KES redemption and payable creation | Akiba-Platform |
| Merchant redemption and statement UI | Akiba-Platform merchant dashboard |
| Member discovery, claim, and wallet | Akiba Hub |
| Reimbursement batch operations | MiniMiles admin Finance, backed by Platform data |

The deprecated MiniMiles merchant dashboard must not receive new product
behavior.

## 2. Canonical terminology

| Term | Meaning |
|---|---|
| Voucher fund | An Akiba-approved parent initiative with a country, currency, dates, and total authorized budget |
| Merchant allocation | A finite portion of a fund assigned to one merchant and one voucher benefit |
| Offer | Customer-facing description of the benefit |
| Claim | Successful eligibility check that assigns one voucher to one canonical member |
| Issued voucher | Single-use voucher owned by one member |
| Reserved exposure | Maximum reimbursement Akiba has committed for issued, unredeemed vouchers |
| Payable | Amount Akiba owes a merchant after a valid redemption |
| Reimbursement batch | One merchant payment covering one or more payables |

Avoid calling the parent object a generic `campaign` in APIs or database code.
Akiba-Platform already uses campaign terminology for raffle and promotional
containers. The admin UI may use **Fund** or **Voucher initiative**.

## 3. Goals

- Let Akiba launch an allocation for a founding merchant without engineering
  or direct SQL access.
- Make the maximum KES exposure obvious before approval.
- Guarantee that every issued voucher is backed by available funding.
- Give Akiba exact control over merchants, countries, quantities, benefits,
  dates, users, and qualifying activity.
- Preserve the existing KES voucher redemption and Miles-on-net-spend behavior.
- Turn each valid redemption into an auditable merchant payable.
- Make pausing distribution independent from honoring vouchers already issued.
- Produce a complete audit trail for every economically meaningful change.

## 4. Non-goals

- Merchant self-service selection of Akiba funding.
- Editing the platform-wide Miles earning rate.
- Converting voucher value through USD, cUSD, or a live exchange rate.
- Paying the customer's merchant transaction.
- Transferable or partially redeemable vouchers.
- Arbitrary administrator-authored code or unrestricted JSON eligibility
  expressions.
- Replacing Akiba-Platform's verification handlers.
- Using the legacy `vouchers` table as the new voucher primitive.

## 5. Roles and permissions

Add explicit permissions rather than relying on the current `super_admin`
wildcard.

| Permission | Purpose |
|---|---|
| `voucher_funds.read` | View funds, allocations, exposure, and performance |
| `voucher_funds.write` | Create and edit drafts |
| `voucher_funds.publish` | Schedule, publish, pause, resume, and end approved allocations |
| `voucher_funds.grant` | Directly grant a voucher to an eligible member |
| `voucher_funds.approve` | Approve or reject financial commitments |
| `voucher_funds.adjust_budget` | Increase an approved commitment or reduce uncommitted budget |
| `voucher_settlements.read` | View merchant payables and batches |
| `voucher_settlements.write` | Create and process reimbursement batches |
| `voucher_settlements.mark_paid` | Record final payment evidence |

Recommended role mapping:

| Role | Access |
|---|---|
| `super_admin` | All permissions |
| `ops_admin` | Read, draft, edit, publish, pause, end, and direct grant |
| `finance_admin` | Read, approve commitments, adjust budgets, and operate settlements |
| `readonly` | Read only |
| `insights_admin` | No access by default |

Rules:

- Drafting and Finance approval are separate actions.
- The creator cannot approve their own fund when the commitment exceeds a
  configurable maker-checker threshold.
- Only Finance or super admin can increase an approved KES commitment.
- Only Finance can record reimbursement payment evidence.
- Open-access development sessions cannot create, approve, publish, grant, or
  settle funded vouchers.

## 6. Information architecture

Change the Vouchers navigation into a group:

```text
Vouchers
├── Overview
├── Akiba-Funded
│   ├── Funds
│   ├── Merchant Allocations
│   └── Member Grants
├── Templates
├── Issued
├── Voucher Pricing
└── Weekly Challenge
```

Finance retains:

```text
Finance
└── Voucher Reimbursements
    ├── Payables
    ├── Batches
    └── Reconciliation
```

Proposed routes:

```text
/vouchers/funds
/vouchers/funds/new
/vouchers/funds/[fundId]
/vouchers/funds/[fundId]/edit
/vouchers/funds/[fundId]/allocations/new
/vouchers/funds/[fundId]/allocations/[allocationId]
/vouchers/grants
/finance/settlements
```

The existing `/vouchers/programs` route may redirect to `/vouchers/funds` after
legacy program operations have been separated from funded allocations.

## 7. Fund creation workflow

### 7.1 Step 1 — Fund

Required inputs:

- Internal name.
- Customer-facing sponsorship label, default `Funded by Akiba`.
- Country, initially an ISO 3166-1 alpha-2 code such as `KE`.
- Funding currency, initially `KES`.
- Start and end timestamps in `Africa/Nairobi`.
- Internal cost center or authorization reference.
- Internal notes.

The fund starts in `draft`.

### 7.2 Step 2 — Merchants

The operator selects active merchants from the canonical Platform partner
directory. The UI supports:

- search by merchant name, slug, country, or partner ID;
- bulk selection;
- a default quantity, such as 10;
- per-merchant quantity overrides;
- excluding suspended or archived merchants;
- showing whether the merchant has active staff able to redeem vouchers;
- showing whether a reimbursement destination is configured.

Each selected merchant receives an independent allocation. One allocation
cannot span multiple merchants.

### 7.3 Step 3 — Benefit

MVP benefit:

```text
type = fixed_off
currency = KES
value = operator controlled
minimum purchase = operator controlled
scope = whole purchase | category | product
```

For the example:

```text
KES 500 off
Minimum purchase: KES 1,500
Quantity: 10
Maximum allocation exposure: KES 5,000
```

The UI must never infer voucher value from a Miles price. Akiba-funded claims
may have a zero Miles acquisition price because eligibility, not Miles spend,
is the acquisition mechanism.

Required controls:

- customer-facing title and description;
- fixed discount value;
- minimum purchase;
- whole-purchase, category, or product scope;
- plain-language terms;
- voucher validity after claim;
- optional hard end date;
- merchant-specific override from the fund defaults.

### 7.4 Step 4 — Eligibility

The operator selects from a versioned rule catalogue. MVP rules are:

- country is in an allowed list;
- Akiba Pass is activated;
- profile country is set;
- minimum account age;
- at least one selected verified activity;
- first Akiba-funded voucher only;
- no previous redemption at the selected merchant;
- one voucher per member per allocation;
- optional claim cooldown across the whole fund;
- member is not blocked or under manual review.

Supported activity keys initially reuse Platform verification handlers:

- `pass_activated`;
- `profile_country_set`;
- `sponsored_game_played`;
- `hub_purchase_completed`;
- `voucher_redeemed`;
- `akiba_miles_spend`;
- `daily_checkin_claimed`;
- `streak_completion`.

The operator may select only supported fields. The UI must not accept arbitrary
SQL, JavaScript, or free-form predicates.

The preview explains eligibility in customer language, for example:

> Available to Kenya members who activated their Akiba Pass and completed one
> qualifying activity. Limited to one per member.

### 7.5 Step 5 — Distribution

Supported modes:

| Mode | Behavior |
|---|---|
| Eligible claim | Member discovers the offer and explicitly claims it |
| Direct grant | Authorized admin selects one eligible canonical member |
| Automatic award | Platform issues after a verified event; post-MVP unless explicitly enabled |

The founding-partner MVP defaults to `eligible_claim`. Direct grant remains
available for support and controlled cohorts.

### 7.6 Step 6 — Funding review

The dashboard calculates, server-side:

```text
allocation maximum exposure = quantity × maximum reimbursement per voucher
fund maximum exposure       = sum(allocation maximum exposure)
```

The review displays:

- total merchants;
- total vouchers;
- maximum KES exposure;
- per-merchant exposure;
- approved, reserved, payable, paid, reversed, and available amounts;
- settlement frequency;
- cost-center reference;
- warnings for missing merchant redemption staff or payout destinations.

Submitting creates a Finance approval request. It does not publish the fund.

### 7.7 Step 7 — Approval and publication

Finance can:

- approve the full commitment;
- reject with a reason;
- return for changes;
- approve a lower quantity or budget only by creating an explicit revision.

After approval, an authorized Ops user may schedule or publish allocations.
Publication must be atomic per allocation and fail closed if any required
runtime record is missing.

## 8. Lifecycle

### 8.1 Fund states

| State | Meaning |
|---|---|
| `draft` | Editable and has no financial approval |
| `pending_approval` | Awaiting Finance review |
| `approved` | Funding commitment approved; not distributing yet |
| `scheduled` | Approved and starts in the future |
| `active` | At least one allocation can issue vouchers |
| `paused` | New claims stopped across all allocations |
| `ended` | New claims permanently stopped; issued vouchers remain valid |
| `cancelled` | Never launched or cancelled before commitments existed |

### 8.2 Allocation states

| State | Meaning |
|---|---|
| `draft` | Editable merchant allocation |
| `pending_approval` | Included in a submitted commitment revision |
| `approved` | Financially approved |
| `scheduled` | Starts in the future |
| `active` | Claims or authorized grants are allowed |
| `paused` | New issuance stopped temporarily |
| `exhausted` | Issuance cap reached or available budget is insufficient |
| `ended` | New issuance stopped permanently |

Pausing or ending never invalidates an already issued voucher. Revocation is a
separate voucher-level action restricted to fraud, error, or legal cases.

## 9. Quantity and budget controls

The UI must distinguish:

| Metric | Definition |
|---|---|
| Allocated | Maximum number approved for the merchant |
| Issued | Successfully assigned to members |
| Redeemed | Successfully used at the merchant |
| Expired | Issued but expired unused |
| Revoked | Administratively invalidated |
| Remaining | Additional vouchers that may still be issued |
| Reserved | Maximum KES exposure backing live issued vouchers |
| Payable | Redeemed amount owed to merchant |
| Paid | Amount already reimbursed |

Rules:

- Quantity may be increased only with sufficient additional approved budget.
- Quantity may be reduced only to a value not below already issued inventory.
- Benefit value, merchant, currency, reimbursement rate, and eligibility rule
  version become immutable after first issuance.
- Editing immutable terms creates a new allocation version.
- Expiry releases an unused reservation according to Platform accounting.
- A fund cannot issue beyond either its quantity cap or approved KES budget.

## 10. Fund detail page

The detail page contains:

### Summary

- State and schedule.
- Country and currency.
- Merchant count.
- Approved budget.
- Reserved exposure.
- Outstanding payables.
- Paid reimbursements.
- Available funding.
- Claim and redemption conversion.

### Merchant allocations

Each row displays:

- merchant name;
- voucher benefit;
- state;
- allocated, issued, redeemed, and remaining counts;
- reserved, payable, and paid KES;
- redemption rate;
- settlement readiness;
- actions appropriate to state.

### Eligibility

- Human-readable rule summary.
- Immutable rule-set version.
- Counts by eligible, ineligible reason, successful claim, and conflict.

### Activity

- Fund revisions.
- Allocation changes.
- Approvals.
- Publication and pause events.
- Direct grants.
- Voucher revocations.
- Settlement events.

### Danger zone

- Pause all new claims.
- End fund.
- Revoke a specific voucher with a required reason.
- Never provide destructive deletion after approval or issuance.

## 11. Direct member grants

The grant tool searches canonical members by safe identifiers such as email,
phone, username, or canonical ID. It must not reveal unrelated profile data.

Before confirmation the server returns:

- masked member identity;
- eligibility result;
- prior claim status;
- allocation availability;
- reservation amount;
- explicit ineligibility reasons safe for an operator.

Grant confirmation requires a stable request ID and reason. Replaying the same
request returns the original voucher. A different member or allocation with the
same request ID returns an idempotency conflict.

Bypass is not available in the MVP. A later bypass, if required, must need
`super_admin`, a reason, and a separate audit event.

## 12. Reimbursement operations

A valid funded redemption automatically creates a merchant payable. Merchants
do not claim the same redemption a second time.

The Finance surface must:

- group unbatched KES payables by merchant;
- show merchant names, not raw UUIDs;
- show voucher, redemption, receipt reference, gross KES, discount KES, and
  reimbursement KES;
- prevent cross-merchant or cross-currency batches;
- support draft, approved, processing, paid, failed, and cancelled batch states;
- require payment reference and evidence before `paid`;
- prevent one payable from entering two live batches;
- export a merchant statement;
- expose reconciliation incidents separately.

Currency rendering must use the row currency. The existing hard-coded `$` and
`cUSD` behavior must be removed before KES payouts launch.

## 13. Admin API contract

Proposed BFF routes:

```text
GET    /api/admin/voucher-funds
POST   /api/admin/voucher-funds
GET    /api/admin/voucher-funds/:fundId
PATCH  /api/admin/voucher-funds/:fundId
POST   /api/admin/voucher-funds/:fundId/submit
POST   /api/admin/voucher-funds/:fundId/approve
POST   /api/admin/voucher-funds/:fundId/reject
POST   /api/admin/voucher-funds/:fundId/publish
POST   /api/admin/voucher-funds/:fundId/pause
POST   /api/admin/voucher-funds/:fundId/resume
POST   /api/admin/voucher-funds/:fundId/end

POST   /api/admin/voucher-funds/:fundId/allocations
PATCH  /api/admin/voucher-allocations/:allocationId
POST   /api/admin/voucher-allocations/:allocationId/publish
POST   /api/admin/voucher-allocations/:allocationId/pause
POST   /api/admin/voucher-allocations/:allocationId/resume
POST   /api/admin/voucher-allocations/:allocationId/end
POST   /api/admin/voucher-allocations/:allocationId/grants

GET    /api/admin/voucher-funds/:fundId/analytics
GET    /api/admin/voucher-funds/:fundId/audit
```

Requirements:

- Browser calls only MiniMiles BFF routes.
- BFF derives actor identity from the authenticated admin session.
- Actor IDs, roles, approval state, financial totals, and merchant scope are
  never trusted from the request body.
- BFF calls a versioned Akiba-Platform internal API using server credentials or
  an exchanged internal-user token.
- Every mutation requires an idempotency key.
- API returns machine-readable error codes and a request/debug ID.
- Platform errors are translated into safe admin messages without hiding the
  debug ID.

## 14. Validation and activation guards

An allocation cannot activate unless:

- its parent fund is approved;
- merchant is active and country-compatible;
- benefit type and KES values are valid;
- quantity is a positive integer;
- maximum allocation exposure fits approved funding;
- start is before end;
- voucher validity is positive;
- eligibility rule set is valid and versioned;
- settlement currency is `KES` for the MVP;
- reimbursement rate is exactly `1` for the MVP;
- at least one distribution mode is enabled;
- required customer copy exists;
- the canonical Platform runtime reports the allocation ready.

## 15. Audit requirements

Every mutation writes an append-only admin audit event containing:

- actor ID and role;
- action;
- fund and allocation IDs;
- merchant ID when applicable;
- old and new values;
- reason;
- idempotency key;
- Platform request/debug ID;
- approval revision;
- timestamp.

High-value events include:

- fund created or edited;
- allocation added, changed, or removed from a draft;
- submitted, approved, rejected, or returned;
- budget increased or reduced;
- published, paused, resumed, or ended;
- direct grant;
- voucher revocation;
- settlement batch created, approved, paid, failed, or cancelled;
- reconciliation incident resolved.

Audit logging is not optional success-path telemetry. If the atomic Platform
operation requires an audit event, the operation fails when the event cannot be
persisted.

## 16. Errors and operator guidance

At minimum, map these Platform codes:

| Code | Admin message |
|---|---|
| `FUND_NOT_APPROVED` | Finance approval is required before publication |
| `BUDGET_EXHAUSTED` | No approved funding remains for this claim or increase |
| `ALLOCATION_EXHAUSTED` | This merchant has issued its full allocation |
| `IMMUTABLE_AFTER_ISSUANCE` | Create a new allocation version to change this term |
| `MERCHANT_NOT_ELIGIBLE` | Merchant is inactive, suspended, or not ready for redemption |
| `ELIGIBILITY_RULE_INVALID` | One or more eligibility rules are unsupported |
| `MEMBER_NOT_ELIGIBLE` | Member has not met the allocation requirements |
| `MEMBER_ALREADY_CLAIMED` | Member already received this allocation |
| `IDEMPOTENCY_CONFLICT` | The request ID was already used with different data |
| `REIMBURSEMENT_DESTINATION_REQUIRED` | Configure merchant payout details before settlement |

## 17. Analytics

Required fund and allocation metrics:

- eligible member views;
- claim attempts;
- successful claims;
- ineligibility reasons;
- issued, redeemed, expired, and revoked vouchers;
- claim-to-redemption conversion;
- median time to redemption;
- gross customer spend associated with redemption;
- voucher discount and net paid;
- maximum, reserved, realized, payable, and paid KES;
- merchant-level redemption rate;
- new versus returning customer, using canonical identity;
- suspicious velocity and manual-review counts.

Do not describe associated purchase value as revenue caused by Akiba. Use
**rewarded customer spend** or **spend associated with funded voucher
redemptions**.

## 18. Testing requirements

### Permissions

- Unauthorized roles cannot mutate funds or settlements.
- Finance approval and Ops publication boundaries are enforced server-side.
- Open-access development sessions cannot write.
- Actor identity cannot be spoofed through request bodies.

### Workflow

- Draft can be edited without financial commitment.
- Submission snapshots the proposed exposure.
- Approval applies to one exact revision.
- Editing economic terms after approval requires reapproval.
- Publication fails closed when any activation guard fails.
- Parent pause stops every new claim.
- Already issued vouchers remain redeemable while distribution is paused.

### Quantity and money

- Ten KES 500 vouchers show KES 5,000 maximum exposure.
- Concurrent grants cannot issue an eleventh voucher.
- Budget and count caps are both enforced by Platform, not only the UI.
- Expiry releases the correct reservation once.
- Redemption moves exposure from reserved to payable once.
- Repeated redemption or settlement requests do not duplicate liability.
- Currency is rendered as KES without `$` formatting.

### Accessibility and operations

- Every wizard control has a label and inline error.
- State is not communicated by color alone.
- Large fund tables are keyboard navigable and paginated.
- Dangerous actions require explicit confirmation and a reason.

## 19. Delivery sequence

### Phase 0 — Contract and access

1. Ratify the companion Platform specification.
2. Add explicit admin permissions.
3. Define admin-to-Platform authentication and actor mapping.
4. Remove hard-coded cUSD assumptions from the Finance UI.

### Phase 1 — Draft and approval

1. Build fund and allocation list/detail pages.
2. Build the creation wizard and server-side exposure preview.
3. Add submit, approve, reject, and revision workflows.
4. Add complete audit coverage.

### Phase 2 — Publication and claims

1. Add publish, pause, resume, and end controls.
2. Add direct grants.
3. Add allocation monitoring and eligibility breakdowns.

### Phase 3 — Reimbursement

1. Upgrade settlement views to KES-native, merchant-readable reporting.
2. Add statement export and payment evidence.
3. Add reconciliation incident workflows.

## 20. Launch acceptance criteria

- An authorized Ops admin can create a fund and allocate an exact quantity to
  each selected merchant.
- Finance sees and approves the exact maximum KES commitment.
- An allocation cannot publish without approval and Platform readiness.
- The dashboard can configure country, activity, per-member, and schedule
  restrictions without accepting arbitrary predicates.
- Quantity and budget changes are audited and cannot invalidate commitments
  already made to members.
- Akiba-funded vouchers are visibly distinct from merchant-funded vouchers.
- A valid redemption produces exactly one KES payable.
- Finance can reimburse the correct merchant with payment evidence.
- Existing merchant-funded vouchers continue to create no reimbursement
  liability.

## 21. Launch configuration still required

The implementation must not hard-code these business decisions:

- participating founding merchants;
- default voucher quantity per merchant;
- fixed discount value;
- minimum purchase;
- total fund budget;
- claim window;
- voucher validity after claim;
- qualifying activities;
- account-age requirement;
- country assurance level;
- maker-checker threshold;
- reimbursement frequency and payment SLA;
- fraud-review thresholds.

They are configuration selected and approved through this admin workflow.
