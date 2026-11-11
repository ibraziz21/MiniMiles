# Akiba new-user welcome offer

Status: Product specification; implementation and launch verification pending.
Date: 2026-11-07 (Africa/Nairobi)

> **Narrowed by [BDR-008](BDR-008-new-user-welcome-offer.md) (2026-11-10):**
> the offer is usable on any one purchase in the first 7 days ("first welcome
> redemption", not strict first purchase); the merchant set is every
> reimbursement-ready merchant, frozen at approval; the 1,000 cap can be raised
> later with a budget top-up; the 7-day clock starts at issue. Where this spec
> and BDR-008 differ, BDR-008 wins.

## Objective and agreed offer

Increase app downloads and convert new users into their first Akiba-recorded
merchant purchase through an immediate discount.

The first 1,000 eligible new signups receive 25% off one first purchase, capped
at KSh 250, valid for 7 days after signup. Akiba funds the discount. Customers
pay the discounted amount; merchants receive customer payment plus an Akiba
reimbursement payable, subject to the existing fees and settlement arrangements.
Reimbursement is not a promise of an immediate merchant payout.

Maximum subsidy commitment: 1,000 × KSh 250 = KSh 250,000. Marketing, payment
fees and operating expenses are separate. Actual subsidy can be lower.

The KSh 1,000 figure is the spend at which the maximum saving is reached, not
a maximum permitted bill or a minimum spend. No minimum spend is proposed.

## Decisions and proposed defaults

Agreed: immediate discount, 25%, KSh 250 cap, one use per new user, seven-day
validity, Akiba funding, and slots allocated to the first 1,000 eligible signups
rather than the first 1,000 redemptions.

Implementation defaults proposed by this spec:

- Enrol only through authenticated native-app onboarding during the campaign.
  A download alone does not establish identity or reserve an offer.
- Use a fixed, published set of participating Kenyan merchants with operational
  KES checkout and reimbursement arrangements. Do not advertise “any merchant”
  unless every advertised merchant is supported.
- No stacking with another voucher or discount on the same purchase in v1.
- No minimum spend, weekday restriction, subscription requirement for the user,
  or manual claim step.
- Expired slots are not reassigned during this pilot. This keeps “first 1,000”
  literal and prevents commitments exceeding the approved envelope.
- Notifications are optional; the offer never depends on permission to notify.

These defaults are product proposals, not observations of deployed behavior.

## Eligibility and allocation

“New” means a canonical Akiba member created during the campaign who has no
older linked Akiba identity and no prior successful Akiba-recorded merchant
purchase. Reinstalling, logging back in, creating another profile, or linking a
new authentication method does not create another entitlement. Historical
purchases across participating and nonparticipating Akiba merchants count.
Purchases outside Akiba cannot be inferred and are not part of this check.

Use the existing verified identity and canonical-account linking rules. Do not
make device ID the sole eligibility key or add a new mandatory verification
step without a separate product decision. Account linking must preserve consumed
eligibility and prevent duplicate spendable welcome offers. Suspected duplicates
can be reviewed through existing support/admin controls.

The server records eligibility and enrolment as part of onboarding completion.
The authoritative signup timestamp starts the clock; expiry is exactly signup
time plus 168 hours. Store timestamps in UTC and display the exact local expiry
date/time in Africa/Nairobi. Eligibility requires a supported native client;
never trust a client-supplied account age, first-purchase flag or app-origin
boolean alone. Reuse authenticated onboarding/channel provenance where available;
document its limits, since client headers cannot prove a physical app install.

Allocate a slot and issue the welcome voucher in one database transaction:

1. Resolve canonical identity and verify campaign, channel and new-user rules.
2. Return an existing enrolment on retry without resetting its expiry.
3. Lock campaign capacity, verify fewer than 1,000 slots have been committed,
   and reserve KSh 250 from the campaign funding envelope.
4. Insert the unique enrolment and issue its linked single-use voucher with
   the benefit, expiry and complete participating-merchant snapshot.
5. Commit all effects together. Failure creates no consumed slot or reservation.

If onboarding and enrolment cannot share a transaction, persist an idempotent
enrolment request with server timestamp and deterministic order during onboarding;
process in that order. Never show an awarded offer before a committed entitlement.
A recovery worker must preserve original expiry and capacity order. Do not
silently substitute first API fetch or first manual claim for signup ordering.
If this guarantee cannot be implemented, revise the public allocation wording
before launch.

Campaign enrolment closes when full, paused, or at its configured end time.
Issued offers remain usable until their own expiry even after enrolment closes.
Do not shorten a user's seven-day window at the campaign end date. App/home
fetches may recover an existing enrolment but must not enrol arbitrary old users.

## Customer experience

### Acquisition and signup

Public headline: **Download Akiba. Get 25% off your first purchase.**

Supporting copy: **Save up to KSh 250 at participating merchants. For the first
1,000 eligible new signups. Use within 7 days of signup. Terms apply.**

Stop presenting the offer as available when enrolment is full or paused. Cached
advertising cannot guarantee a slot; signup must return an explicit availability
result. Preserve the user's signup if the campaign is unavailable.

After confirmed issuance show: **Your welcome offer is ready — save 25%, up to
KSh 250, on your first purchase.** Include exact expiry and “Find a merchant”.
No promo code, manual claim or notification permission is required.

### Home, wallet and merchant discovery

Show one welcome-offer card on home and the linked voucher in My vouchers.
Both represent the same entitlement, not two rewards. Display benefit, exact
expiry, single-use terms and access to the full participating merchant list.
“Find a merchant” filters to the voucher's snapshot participants. Merchant pages
explain eligibility and offer a route to the owned voucher/QR.

Voucher detail explains: show the QR at checkout; the merchant enters the bill;
pay the discounted total. Larger bills remain eligible. Reuse existing secure
presentation tokens; do not encode a reusable discount authorization in a URL.

States: checking availability, active, redeemed, expired, unavailable, and
ineligible. Network failure is retryable and must not masquerade as ineligibility
or remove an issued voucher. Redeemed state shows actual merchant, saving and
receipt. Expired state explains that the welcome offer has ended.

### Checkout and receipt

Use the existing merchant till inspect/confirm flow. Scan the owned voucher,
enter the gross eligible bill, and show gross, Akiba discount and customer due
before confirmation. Do not describe this as an automatic online payment unless
the actual payment integration supports it.

| Gross bill | Akiba discount | Customer pays |
|---|---:|---:|
| KSh 200 | KSh 50 | KSh 150 |
| KSh 600 | KSh 150 | KSh 450 |
| KSh 1,000 | KSh 250 | KSh 750 |
| KSh 1,500 | KSh 250 | KSh 1,250 |

No cashback or customer credit balance is created. Discounts cannot be withdrawn,
transferred or split over purchases. Receipt copy: **You saved KSh [amount] with
your Akiba welcome offer.** Merchant receipt/statement identifies the Akiba-funded
amount separately from the money collected from the customer.

Optional reminder: once, 24 hours before expiry, only while active and where
permission exists. Recheck entitlement before sending and suppress after use.
Reminder failure must not affect redemption. This is optional pilot scope.

## Checkout integrity and money

Calculate in integer KES minor units on the server:

`discount_minor = min(floor(eligible_gross_minor * 25 / 100), 25000)`

`customer_due_minor = gross_minor - discount_minor`

Reject zero/negative bills and a zero calculated discount. The eligible amount
is the purchase amount accepted by the existing till; separately charged payment
fees/tips are excluded. Preserve existing tax treatment. Do not introduce a new
tax calculation. Quotes are estimates until revalidated on commit.

At commit, lock the canonical member's first-purchase eligibility and voucher,
verify expiry using database time (`now < expires_at`), merchant snapshot,
campaign entitlement, receipt rules and existing merchant readiness policies.
Every competing purchase path must participate in the same first-purchase gate;
otherwise two concurrent purchases could both appear to be first.

If a user completes an undiscounted first Akiba purchase, invalidate the unused
welcome entitlement and release its funding reservation. Warn before proceeding
without the available welcome offer where the channel can do so. If another
voucher is chosen, explain that the first-purchase welcome offer will be lost.
If cross-channel first-purchase enforcement cannot be guaranteed, it is a launch
blocker or the offer must be explicitly redefined as “first welcome redemption”.

Failed/cancelled checkout does not consume the offer. Successful committed
checkout must produce exactly one purchase, redemption, normal applicable Miles
award, campaign redemption record, and payable to the actual redeeming merchant.
Preserve existing Miles earning rules and award on the existing authoritative
eligible amount; verify the current net-spend behavior rather than hardcoding a
new reward rate.

For external collection, “success” means the merchant confirms receipt of the
discounted customer payment through the established till process. This is an
audited merchant attestation, not evidence of payment-provider settlement. For
integrated payment, tie final consumption to authoritative payment confirmation;
a quote or pending payment must not consume the offer. Any temporary payment
hold needs a bounded release/reconciliation path and must not extend expiry.

Exact retries return the original result. Concurrent redemptions at different
merchants yield at most one successful financial result. The final transaction
releases the full KSh 250 reservation and realizes only the actual discount as
campaign expense and merchant reimbursement. Expiry or first-purchase invalidation
releases unused reservation exactly once without increasing signup capacity.

Refund default: do not automatically reissue a consumed welcome offer. Use the
existing audited refund process to reverse/adjust the purchase, Miles and
merchant payable. For a partial refund, retain the original eligible bill and
discount, then recompute retained subsidy under the same formula on the retained
eligible value. Reconcile customer refund plus subsidy reversal to refunded gross;
never refund the subsidized portion to the customer as cash. Paid merchant
reimbursements require the existing recovery/offset procedure. Finalize the
operational refund procedure before launch; do not add an unreviewed refund API.

## Implementation fit and proposed contracts

Reuse the funded percentage voucher, multi-merchant snapshot, secure QR, atomic
KES redemption, funding ledger and merchant reimbursement pipeline. Add campaign
enrolment and canonical first-purchase eligibility; a catalogue-only filter or
ordinary manual funded claim is insufficient.

Source references (implementation observations, not deployment verification):

- [Multi-merchant launch spec](multi-merchant-funded-vouchers-launch-spec.md).
- [Checkout verification](multi-merchant-browser-checkout-verification.md).
- Mobile contracts/API: `packages/akiba-app/src/contracts/` and
  `packages/akiba-app/src/api/client.ts`.
- Existing funded-offer UI: `packages/akiba-app/src/components/funded-offer-card.tsx`
  and `packages/akiba-app/src/components/funded-offer-claim.tsx`.
- Campaign mapping: `packages/hub-page/src/lib/vouchers/fundedCampaign.ts`.
- Existing multi-merchant claim migration: `supabase/migrations/113_multi_merchant_funded_claims.sql`.

Proposed persistent additions, adapted to existing schemas during implementation:

- Campaign configuration: enrolment start/end, state, native channel scope,
  maximum enrolments 1,000, subsidy budget 25,000,000 minor units, percentage 25,
  cap 25,000 minor units, TTL 168 hours, approved participant set and terms version.
- Enrolment: campaign ID, canonical member ID, authoritative signup/enrolment and
  expiry timestamps, linked issued voucher, state/reason and terms snapshot.
  Unique `(campaign_id, canonical_member_id)` plus a unique linked voucher.
- Purchase/redemption links for eligibility and reporting; use existing immutable
  financial records instead of maintaining a second reimbursement ledger.

Return an additive `welcomeOffer` summary from onboarding completion and the
authenticated home API: state, reason code, voucher ID, discount percentage,
maximum saving/currency, exact expiry and supported detail/discovery destination.
Reuse existing owned-voucher and presentation endpoints. Do not expose private
identity, internal budget or merchant payout data in member responses.

Reason codes should distinguish campaign not started/full/paused, existing member,
prior purchase, unsupported channel, expired, redeemed and temporary failure.
State and reason vocabulary must be reconciled with current API conventions.
Old app versions must not receive unsupported multi-merchant/percentage shapes;
release behind existing capability/minimum-version gates. A safe supported route
must remain available for already issued vouchers.

## Operations and measurement

Admin review before activation shows dates, merchant set/readiness, terms,
1,000-slot limit and KSh 250,000 commitment. Track enrolled, active, redeemed,
expired, invalidated, reserved funding, realized subsidy and reimbursement status.
Pause stops new enrolments, not valid issued offers. Do not use publication pause
to silently revoke the seven-day promise. Record operator actions in the existing
audit system. Individual support actions must be authorized and auditable.

Measure campaign-source landing visits, store-link clicks, attributed installs
where tooling supports them, signup completion, issued offers, first purchases,
redemptions, gross/net purchase values, subsidy and later repeat purchases.
Downloads are not equal to signups or redemptions; report each separately and
label attribution gaps. Server-side successful purchase and subsidy records are
the conversion/accounting source of truth. Client analytics must follow existing
PII restrictions and must not log phone numbers, QR tokens or wallet identifiers.

Core metrics:

- Signup-to-redemption rate = redeemed welcome users / enrolled users.
- Subsidy per converted user = realized subsidy / redeemed welcome users.
- Total acquisition cost includes campaign marketing, not just the discount.
- Second-purchase rate at 14 and 30 days, using only cohorts old enough to measure.

## Acceptance and launch gates

1. Eligible signup automatically receives exactly one offer with signup +168h
   expiry; retry, reinstall and account linking do not reset it.
2. Concurrent signups at capacity allocate exactly the remaining slots. The
   1,001st eligible signup receives no offer; total commitment never exceeds
   KSh 250,000. Failed issuance rolls back its slot and reservation.
3. Existing accounts, prior purchasers and disallowed channels cannot enrol via
   direct requests. Recoverable onboarding failures preserve ordering/expiry.
4. All calculation examples pass, including minor-unit rounding, bills above
   KSh 1,000, and exact expiry. Device-clock changes cannot extend validity.
5. Snapshot merchants are visible before use and on the QR/detail screen. A
   secondary participating merchant can redeem; an outside merchant cannot.
6. Duplicate/concurrent checkout produces one purchase, redemption, Miles award
   and payable. Failed payment/abandoned quote consumes nothing.
7. Concurrent undiscounted and welcome purchases enforce the canonical first-
   purchase rule across all supported channels.
8. Reimbursement goes to the actual merchant for the actual discount; funding
   reservation release, realization and replay are verified from committed rows.
9. Expiry and invalidation release funding once. Paused/full enrolment does not
   invalidate issued offers. Refund and paid-payable recovery scenarios reconcile.
10. Native onboarding, home, voucher, merchant discovery and till/receipt flows
    pass end-to-end on supported iOS/Android builds. Test offline/retry states,
    exact expiry display and older-client handling.

Implement in order: server eligibility/enrolment and funding; checkout gate and
accounting; API/mobile surfaces; admin reporting and acquisition copy. Run relevant
database integration tests, affected API tests and package lint/typechecks.
Before launch, verify the real target schema/migration order and run an end-to-end
staging checkout against that schema, including secondary-merchant accounting.
Existing replay evidence alone is not proof of the full deployed migration chain.

Campaign dates, approved merchant list, identity/purchase-history audit, payment
confirmation semantics and refund operating procedure must be recorded before
activation. Begin with synthetic staging users and a separately funded controlled
pilot; do not spend or enrol production users through this specification alone.
