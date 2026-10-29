# Multi-merchant funded vouchers — launch specification

Status: Ready for implementation; not a deployment approval or verification report.
Date: 2026-10-28
Decision: [BDR-006](BDR-006-multi-merchant-funded-vouchers.md)

## Outcome

An operator can publish one funded discount offer redeemable once at any merchant
in an approved set. Members can see the complete set before claiming and on their
issued voucher. The merchant that performs redemption receives the purchase
attribution and reimbursement payable. An older mobile app must never advertise
the offer as usable at only its primary merchant.

Example: an offer names merchants A, B and C. A member claims one voucher, uses it
at B, and cannot use it again at A or C. B alone receives the purchase, Miles
attribution and payable. There is no customer balance or partial redemption.

Initial release: web discovery, claiming, owned vouchers and the existing KES till.
Mobile discovery remains disabled until the mobile contract and display support
are released and the minimum supported version is enforced.

## Existing implementation and remaining work

These are source observations, not confirmation of shared database deployment:

| Area | Current state | Required for launch |
|---|---|---|
| Platform migration 154 | Merchant relation, computed set, shared inspect/redeem gate, draft setter | Verify current migration chain and full redemption |
| MiniMiles migration 113 | Claim snapshot and set-wide new-customer rule | Verify with schedules and current Platform definitions |
| Admin creation | Additional merchant selection; separate create and set RPCs | Atomic save, draft editing, review display |
| Member discovery | Primary merchant only | Complete merchant list and secondary merchant lookup |
| v1 compatibility | Percentage filter only | Independent multi-merchant exclusion |
| Integration tests | Set, snapshot, inspect and eligibility coverage | Real redemption, award and financial records |

## Rules and invariants

1. Allocation primary merchant remains mandatory and aligned with its template.
   The complete eligible set comes from
   `voucher_allocation_eligible_merchants(allocation_id)`; callers must not treat
   the additional-merchant relation alone as the complete set.
2. Merchant membership is editable only while the allocation is draft. Approval
   and publication use the persisted set. There is no live membership editing in
   this release; changing participants requires a new allocation.
3. Every newly issued funded voucher snapshots the complete set. Redemption and
   owned-voucher display use that snapshot, never the allocation's current set.
   Legacy vouchers without a set retain their existing single-merchant behavior.
4. The voucher is single-use across the entire set. Concurrent attempts at two
   eligible merchants may produce at most one redemption and one payable.
5. All existing benefit, expiry, country, subscription, receipt, schedule and
   funding restrictions continue to apply. Membership alone does not onboard a
   merchant or make its till operational.
6. `no_prior_merchant_redemption` checks previous redemption at any member of the
   eligible set. Member copy: “For customers who have not previously redeemed a
   voucher at any participating merchant.”
7. An incomplete merchant lookup must not silently shrink the advertised set or
   downgrade an offer to single-merchant. Withhold an unclaimed offer if its set
   cannot be resolved; preserve issued entitlement IDs and show an explicit
   unavailable-details state for an owned voucher.

Update BDR-006 §4.2 to distinguish snapshot guarantees from live editing: its
adding/removing examples describe snapshot semantics, not an enabled operator
workflow. Draft-only membership is the release policy.

## Admin authoring and review

Keep the primary selector and “Also redeemable at” selection. Show the total
unique merchant count and selected merchant names. Exclude the primary from the
additional selection, deduplicate IDs, and reject malformed IDs server-side.
Use the existing country normalization and active-partner policy for all members.

The existing draft allocation PATCH endpoint must load, display and replace
additional merchants. Explicit `additionalMerchantIds: []` clears extras;
omission on PATCH preserves them. Changing primary must leave the resulting set
deduplicated and consistent with the template. Reject edits after draft using
the database state, regardless of what the form shows.

Creation and draft updates must save allocation fields and merchant membership
in one database transaction. Add a wrapper RPC around existing operations or
extend the current RPC contracts safely; do not sequence independent HTTP/RPC
transactions. A failed merchant check leaves no new allocation/template/audit
artifacts from creation and no partial changes from editing. Preserve existing
roles, authorization and audit conventions.

Draft edits must carry the version loaded by the operator and reject stale
writes. Validate and lock state/version inside the transaction; two operators
must not silently overwrite each other's approved selection.

Allocation details and the approval surface must show primary, all additional
merchants, count and readiness warnings. Persist an audit entry containing the
before/after set, actor and allocation. Reload the persisted result after save.

Before publishing a multi-merchant allocation, check every member is active,
country-compatible and has an eligible subscription under the current till
policy. A known unready merchant blocks publication with its name and reason.
Readiness is checked again by the existing redemption flow when used; it is not
an indefinite guarantee. Payout-destination readiness should be visible to the
operator and retain its existing settlement policy.

## Discovery and contracts

Extend `FundedOffer` additively:

```ts
merchant: MerchantSummary;    // existing primary, unchanged
merchants: MerchantSummary[]; // complete unique eligible set, primary first
```

Use the existing merchant summary fields required for identity, name, merchant
link and image; do not expose subscription, payout or private partner fields.
Return the full array for single-merchant offers too. Sort remaining members
deterministically. Derive multi-merchant status from the authoritative complete
set, not from the number of successfully loaded profiles.

Update `catalogue.server.ts`, `merchantFundedOffers.server.ts` and the shared
`fundedOfferMapping.ts`. Resolve memberships and public merchant details in
batches; avoid one query per offer or merchant. Deduplicate allocation IDs.
A secondary merchant's page must show the same allocation ID, claim state,
benefit, capacity and rules as the primary merchant's page. Existing publication,
country, claim-window and eligibility filters must remain in force.

Cards with multiple merchants show “Use once at any of N merchants”, with an
accessible link/control to the full participant list. The details/claim surface
lists every merchant with its merchant-page link. A merchant-page card must not
suggest a separate voucher is needed at each stall. Single-merchant copy remains
unchanged. Keep claim-day restrictions distinct from redemption schedules.

Owned-voucher details and QR presentation must show snapshot participants and
the single-use wording. Resolve snapshot IDs to public profiles without replacing
them with the current allocation set. Missing/archived profiles must not erase
the entitlement or invent new eligible merchants. Audit all issued-voucher web
and API serializers for assumptions that `merchant_id` is the only participant.

## Mobile compatibility and release gates

Add an independent server flag, proposed name
`MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED`, default false. Confirm naming against
the existing feature-flag conventions during implementation.

`fundedOffersForV1()` applies both filters independently:

| Percentage flag | Multi-merchant flag | Eligible offer shapes |
|---|---|---|
| Off | Off | Single-merchant fixed offers |
| On | Off | Single-merchant fixed and percentage offers |
| Off | On | Single- and multi-merchant fixed offers |
| On | On | All otherwise eligible offers |

The current percentage-enabled early return must not bypass the new filter.
Apply the shared filter on v1 home, vouchers and merchant detail responses.
Direct v1 claim requests must also reject unsupported multi-merchant allocations
when the flag is off, before issuance, using the API's existing error envelope.
Catalogue hiding alone is insufficient.

Before web launch, verify old mobile builds can safely show a multi-merchant
voucher claimed on web. If they misrepresent it, filter those vouchers from the
legacy owned-voucher/presentation endpoints while the flag is off and provide a
supported web route to access them. Preserve historical single-merchant vouchers
and redemption history. Cover this cross-channel case explicitly in tests.

Mobile release work includes the Zod contract, cards, merchant pages, participant
details, owned vouchers and QR surfaces. Missing `merchants` on legacy responses
falls back to `[merchant]`. Enable the global flag only after unsupported builds
are prevented from accessing that contract; store availability alone is not
evidence of adoption. Percentage support remains a separate decision.

## Required verification

Extend the existing tests rather than treating the selected-fixture suite as a
complete production migration replay. Validate the current combined migration
order in a disposable database with the real Miles award dependencies. Inspect
live function definitions to catch later migrations that replace a widened gate.

| Scenario | Required result |
|---|---|
| Redeem at secondary B | Purchase, redemption, Miles and payable attributed to B; none attributed to primary A |
| Funding accounting | One full reservation release; realized reimbursement and payable match the existing benefit/cap rules |
| Replay successful checkout | Same committed response; no duplicate purchase, award, redemption, ledger entry or payable |
| Simultaneous redemption at A/B | Exactly one success and one financial outcome; other attempt cannot consume voucher |
| Outside merchant | Inspect and redeem reject; no state or financial mutation |
| Ineligible subscription | Existing till rejection; no mutation |
| Disallowed redemption day | Full transaction rolls back, including purchase, Miles and funding effects |
| Legacy voucher | Original primary-only behavior |
| Snapshot composition | Merchant set, benefit and migration 112 schedule all survive issuance |
| Invalid additional merchant | Create/edit fully rolls back; no misleading success or duplicate recovery draft |
| Stale/non-draft edit | Rejected without altering approved terms |
| Discovery | Offer appears once on every participant's page; absent from unrelated pages |
| Compatibility | All four flag combinations; every v1 catalogue route, direct claim and web-claimed owned voucher |
| Display | Complete participants before claim and from snapshot after claim; lookup failures cannot mislabel scope |

Run relevant Hub/admin/mobile typechecks and affected tests. Record actual
commands, results and any skips. Negative-test removal of the redeem merchant
gate and incorrect payable merchant attribution; the new tests must fail.

## Rollout and operational acceptance

1. Inventory applied migrations and current inspect/redeem/claim definitions in
   the target environment. Check new migration numbers for collisions across both
   repositories. If 154/113 are already applied, corrections require forward
   migrations rather than editing deployed history.
2. With multi-merchant publication held, apply Platform 154 before MiniMiles 113,
   including their existing prerequisites (notably schedule migration 112), then
   any new transaction/readiness migrations in their documented dependency order.
3. Deploy admin and web discovery/owned-voucher changes with the v1 flag off.
   Verify the effective flag and all required database functions before allowing
   an operator to publish. A partially deployed environment must reject
   multi-merchant authoring/publication rather than silently save primary-only.
4. In staging, create a small A/B allocation, review the persisted participants,
   publish, discover from B, claim on web and redeem through B's actual till.
   Inspect the purchase, award, reservation release and payable. Repeat the same
   checkout and verify no duplicates. Confirm old-client exclusion.
5. Publish a limited production pilot only after these checks pass. Record its
   allocation ID, participants, deployed versions and verification evidence.
   Confirm subscriptions and the operational payout arrangements before the event.
6. Monitor failed inspect/redemption codes, missing participant resolution,
   unexpected payable merchants and duplicate financial records during the pilot.
   Use existing logs/reporting; do not log presentation tokens or member secrets.
7. Release mobile support separately and enable the compatibility flag only after
   its release gate is satisfied.

On an incident, pause affected allocations using the existing lifecycle controls
to stop new claims, and disable mobile discovery if needed. Pausing discovery or
claims is not assumed to revoke issued vouchers. Keep the snapshot-aware runtime
and participant display for outstanding vouchers; use existing explicit revoke
or reimbursement procedures when required. Do not drop the relation or revert
the merchant gate while multi-merchant vouchers remain outstanding.

## Definition of live

Web is live when atomic admin authoring/review works, all member web surfaces
show the correct set, older clients are protected, a real secondary-merchant
checkout has passed the financial assertions, and the documented deployment and
pilot checks have passed. Mobile is live only after its independent contract,
display, minimum-version and flag gates pass.

---

## Verification gap: what the replay harness does and does not prove

Recorded 2026-10-28, against
`packages/hub-page/src/__tests__/integration/helpers/platformReplay.ts`.

### Replayed, and therefore real

The **full Akiba-Platform migration history** applies cleanly, whole-file, with
no partial application. That is where the voucher, funding and Miles engine
lives: `issued_vouchers`, `spend_voucher_templates`, `voucher_funding_*`,
`voucher_redemptions`, `purchase_events`, `miles_ledger`,
`award_purchase_reward_v2`, `redeem_kes_voucher_and_award_atomic`. Plus the
MiniMiles funded-voucher migrations (110–113). Order comes from a committed,
reviewable manifest (`migration-order.json`), and the suite asserts zero
unexpected failures, zero manifest drift, and that each critical function's
current definition contains an expected fragment — so a failed replacement
leaving an older version behind is caught rather than passing silently.

### Not replayed — the gap

**MiniMiles' migration history is not self-contained.**
`001_voucher_platform_phase1.sql` states its prerequisites as tables that
"must already exist in live Supabase" — `issued_vouchers`,
`spend_voucher_templates`, `merchant_transactions`, `merchant_products` —
created outside the migrations directory. **56 MiniMiles migrations cannot
apply from the repository alone**, and a retry-to-convergence pass makes zero
progress on them, so no ordering fixes it. They are listed explicitly in
`migration-excluded.json` with each error.

Several of the 56 touch voucher, funding or Miles tables (001–005, 031, 035,
040, 044, 046 among them). **So these suites do not prove the behaviour of
MiniMiles-side order, referral, dispute, reconciliation or Miles-spend
migrations that write to the same tables.**

Four member-identity tables are **hand-written fixtures**, not replayed, because
they come from those unapplicable migrations: `hub_user_canonicals`,
`hub_user_profiles`, `hub_user_passes`, `leaderboard_profiles`, plus the legacy
`users` table. What is stubbed is who the member is, not what happens to the
money — but the shapes were reconstructed from migration source and could
diverge from production.

### Also unverified

**The manifest order is not production's order.** It was derived empirically —
the order in which migrations successfully apply — not from the live database's
applied-migration records. An earlier version derived it from git commit
dates, which is a weaker signal still: `%cI` moves whenever an old migration is
edited. `MIGRATION_ORDER_VERIFIED_AGAINST_PRODUCTION` is `false` and must stay
so until reconciled against the live migration history table.

This matters concretely: MiniMiles 068 redefines
`issued_vouchers.chk_iv_acquisition_source` **without** the funded values that
Platform 129/133 add. An order placing 068 last makes every funded claim fail a
check constraint.

Commit dates suggest 068 was authored before 129/133, which would mean the
funded values survive — but **that is authoring order, not apply order, and it
is not evidence about any database.** The live constraint definition must be
read from the target environment before relying on it:

```sql
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'chk_iv_acquisition_source';
```

It must contain `akiba_funded_claim`, `akiba_funded_grant` and
`akiba_funded_auto_award`. If it does not, funded claims will fail there
regardless of what the migration files say.

### Closing the gap

The procedure is in
[multi-merchant-staging-verification-runbook.md](multi-merchant-staging-verification-runbook.md).
A fresh database built from the same partial manifest closes nothing — it
re-tests the same subset. The gap closes only against a staging database
carrying the real schema, including the 56 excluded MiniMiles migrations and
the real identity tables.

### Consequence for launch

The staging run against a real database (rollout step 4) is **not a formality**.
It is the only thing that covers the 56 excluded migrations, the real identity
tables, and the true apply order. Publication stays blocked until it passes.
