# Akiba-Funded Vouchers — Profile Country Eligibility Specification

**Status:** Proposed implementation specification

**Initial market:** Kenya (`KE`)

**Owners:** MiniMiles Admin Dashboard, Akiba Hub, Akiba-Platform

**Builds on:**

- `akiba-funded-voucher-admin-spec.md`
- `akiba-funded-voucher-launch-hardening-spec.md`
- `voucher-web2-username-identity-spec.md`

---

## 0. Decision

Every Akiba-funded or sponsor-funded voucher program is country-scoped. A
member may acquire a voucher only when the country explicitly saved on that
member's current Akiba Hub profile matches the funding program's country.

For a Kenya program, the required policy is:

```text
hub_user_profiles.country_code = 'KE'
AND voucher_funding_programs.country_code = 'KE'
```

This is a system invariant, not an operator-selectable eligibility rule.

All recipient identity follows the Web2 voucher identity contract: the public
recipient is an Akiba `@username`, the durable owner is the resolved
`hub_user_id`, and no wallet may participate in eligibility, acquisition,
ownership, presentation, or redemption.

For Kenya-funded offers:

- a profile explicitly set to Kenya is eligible for the country gate;
- an unset, blank, `Other`, invalid, or unrecognized profile country is not
  eligible;
- a profile set to another country is not eligible;
- a country found only on a legacy wallet or legacy `users` row is not
  sufficient;
- an IP address, device location, phone prefix, merchant country, or another
  linked identity's profile must never substitute for the current member's
  saved Hub profile;
- internal grants and automatic awards are subject to the same rule and have
  no country bypass.

The final check occurs inside the atomic funded-voucher claim transaction.
Hub and API eligibility previews improve the experience but are not the
authorization boundary.

---

## 1. Goals

- Guarantee that only members with Kenya explicitly selected on their Akiba
  profile can claim a Kenya-funded offer.
- Fail closed when profile country, program country, or country-policy data is
  unavailable.
- Use one canonical ISO 3166-1 alpha-2 representation across Hub, Admin,
  Platform, and Postgres.
- Apply the same invariant to self-claims, internal grants, and automatic
  awards.
- Preserve idempotent replay of an already-successful claim.
- Give an unset-profile member a clear path to update their profile.
- Preserve already-issued vouchers if the member later changes their country.
- Record sufficient decision evidence for audit and reconciliation without
  relying on mutable profile state later.

## 2. Non-goals

- Verifying physical residence, citizenship, or current GPS location.
- Treating a self-declared profile country as KYC.
- Inferring country from a wallet, phone number, IP address, locale, or device.
- Revoking an issued voucher merely because the profile country later changes.
- Adding a country override for support or Admin users.
- Changing country behavior for ordinary merchant-funded Miles vouchers.
- Defining merchant-country onboarding requirements beyond the existing
  funded-allocation merchant check.

---

## 3. Canonical terminology

| Term | Meaning |
|---|---|
| Profile country | Country explicitly saved on the authenticated member's `hub_user_profiles` row |
| Profile country code | Strict ISO 3166-1 alpha-2 value stored in `hub_user_profiles.country_code` |
| Program country | ISO-2 value stored in `voucher_funding_programs.country_code` |
| Country gate | Mandatory equality check between profile country code and program country |
| Country preview | Non-authoritative Hub or Platform response used to explain eligibility |
| Country evidence | Immutable normalized country decision saved with a successful voucher claim |
| Current member | The exact authenticated `hub_user_id` receiving the voucher, not any member sharing a canonical identity |

---

## 4. Normative eligibility policy

### 4.1 Required predicate

A new funded-voucher claim is country-eligible only when all of the following
are true:

1. `p_hub_user_id` is present and resolves to the authenticated or selected
   Hub member receiving the voucher.
2. A `hub_user_profiles` row exists for that exact `hub_user_id`.
3. `hub_user_profiles.country_code` is a recognized ISO-2 value.
4. `voucher_funding_programs.country_code` is a recognized ISO-2 value.
5. The two normalized codes are equal.

For the Kenya pilot, both values must equal `KE`.

### 4.2 Decision matrix

| Saved profile state | Normalized code | Kenya claim |
|---|---:|---|
| `Kenya` migrated from an existing profile | `KE` | Allow |
| `KE` | `KE` | Allow |
| ` kenya ` migrated from an existing profile | `KE` | Allow |
| No profile row | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| Profile row, country unset | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| Blank value | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| `Other` | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| Invalid or unrecognized value | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| `Uganda` / `UG` | `UG` | Deny: `COUNTRY_NOT_ELIGIBLE` |
| Legacy wallet country is Kenya; Hub profile is unset | `NULL` | Deny: `COUNTRY_PROFILE_REQUIRED` |
| Another Hub user on the same canonical identity has Kenya | Current user's value | Do not use the other profile |
| Program country is missing or invalid | N/A | Deny: `COUNTRY_POLICY_UNAVAILABLE` |

### 4.3 No override

The country gate cannot be bypassed by:

- `super_admin`;
- `internal_grant`;
- `auto_award`;
- an `internal_override` country assurance value;
- a custom eligibility rule set;
- a manually supplied country in an API request;
- direct invocation of the claim RPC with service-role credentials.

### 4.4 Acquisition only

The country gate applies when creating a new claim and voucher reservation.
It is not re-evaluated at redemption.

An already-issued voucher remains redeemable after a profile-country change,
subject to its normal merchant, state, expiry, spend, and fraud controls. A
separate explicit revocation action remains available for confirmed abuse.

### 4.5 Idempotent replay

An exact replay of an already-successful claim returns the original claim and
voucher even if the member's profile country subsequently changes.

Before replaying, the atomic function must verify that the stored claim belongs
to the same canonical member and Hub user. A reused idempotency key belonging
to another identity returns `IDEMPOTENCY_CONFLICT`.

---

## 5. Data model

### 5.1 Canonical profile country code

Add a nullable canonical code to the Hub profile:

```sql
ALTER TABLE public.hub_user_profiles
  ADD COLUMN IF NOT EXISTS country_code text;

ALTER TABLE public.hub_user_profiles
  ADD CONSTRAINT hub_user_profiles_country_code_iso2
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
```

`country` may remain as display text for compatibility. Financial eligibility
must read `country_code`, never the display field.

The column remains nullable because members are allowed to leave profile
location unset; those members simply cannot acquire country-funded vouchers.

### 5.2 Supported-country catalogue

One canonical catalogue must map UI options to ISO-2 codes. The initial values
are:

| Display name | Code |
|---|---:|
| Kenya | `KE` |
| Uganda | `UG` |
| Tanzania | `TZ` |
| Nigeria | `NG` |
| Ghana | `GH` |
| Rwanda | `RW` |
| South Africa | `ZA` |
| Zambia | `ZM` |
| Ethiopia | `ET` |

`Other` is a valid UX choice only if product wishes to retain it, but it maps
to `NULL` and never satisfies a funded country gate.

Unknown free-form strings do not normalize to themselves and must never be
uppercased into a pseudo-code. A strict profile normalizer returns either a
known two-letter code or `NULL`.

### 5.3 Existing-row backfill

Backfill `country_code` only for recognized existing values:

```text
Kenya / KE -> KE
Uganda / UG -> UG
...
```

Blank, `Other`, and unrecognized values remain `NULL`. The migration must not
guess or infer a country from legacy wallet rows.

The backfill is idempotent and reports counts for:

- recognized and populated;
- already canonical;
- unset;
- unrecognized.

### 5.4 Claim evidence

On a successful new claim, the atomic claim function writes:

```json
{
  "systemPolicy": "profile_country_equals_program_country",
  "policyVersion": 1,
  "profileCountryCode": "KE",
  "programCountryCode": "KE",
  "source": "hub_user_profiles.country_code",
  "satisfied": true
}
```

The claim's existing `country_code` is set to `KE` and `country_assurance` is
set to `self_declared_profile`.

The API caller may send preview data, but the database constructs or overwrites
the authoritative country portion of `eligibility_snapshot` from rows read
inside the transaction.

---

## 6. Profile write contract

### 6.1 Hub API

The Hub profile API accepts a supported country code or supported display name,
normalizes it, and calls the profile RPC. It rejects arbitrary nonempty text.
Blank update values are rejected. If the product retains an explicit `Other`
option, the API stores compatible display text with `country_code = NULL`;
`Other` is never treated as a recognized country for funded eligibility.

Recommended request:

```json
{
  "countryCode": "KE",
  "city": "Mombasa"
}
```

The server, not the browser, resolves the display name.

### 6.2 Atomic profile update

`set_hub_profile_country` must:

1. acquire the same per-user country-policy advisory lock used by the funded
   claim RPC;
2. validate the supplied code against the supported-country catalogue;
3. write `country_code` and compatible display text atomically;
4. update `updated_at`;
5. emit the existing first-set event when appropriate;
6. record a restricted audit event for subsequent country changes.

Suggested lock key:

```sql
pg_advisory_xact_lock(hashtext('hub-profile-country:' || p_user_id::text));
```

The API must not accept `p_user_id` from the browser. It derives the user from
the verified session.

### 6.3 Country changes

Members may change their profile country. The change affects future claims but
does not alter prior claim evidence or invalidate issued vouchers.

The audit record stores the previous and new ISO-2 codes, actor, and timestamp.
It does not contain wallet addresses, email addresses, or unrelated profile
data.

---

## 7. Admin control-plane behavior

### 7.1 Program country

Every funded program has a required immutable ISO-2 country after approval.
The Kenya pilot uses `KE`.

Changing country after approval or after any allocation exists requires a new
funding program. It is not a draft edit to a live program.

### 7.2 Allocation invariant

Every allocation automatically inherits the parent program's country gate.
The Admin does not create, toggle, or delete this invariant through
`voucher_eligibility_rule_sets`.

The allocation form displays a locked policy row:

> **Required:** Member profile country must be Kenya.

Additional audience rules remain configurable only when separately supported.

### 7.3 Publication guard

Allocation submission, approval, and publication fail when:

- the parent program has no valid country code;
- the country-policy database contract is unavailable;
- the allocation or template is associated with a different country;
- an operator attempts to weaken or override the system policy.

Required error: `COUNTRY_POLICY_UNAVAILABLE`.

### 7.4 Existing rule sets

Existing `country_in` and `profile_country_set` rules may be retained in stored
rule-set snapshots for historical readability, but they are not the financial
authorization boundary.

New Admin rule sets should stop emitting these two rules once the system
invariant is deployed. During rollout, duplicate evaluation is permitted only
if it uses the same canonical `country_code` and cannot disagree with the
system gate.

---

## 8. Hub experience

### 8.1 Discovery states

| Member state | Offer behavior |
|---|---|
| Anonymous | Offer may be visible with `Sign in to claim` |
| Signed in, profile country unset | Show locked offer with `Set your country to Kenya` |
| Signed in, profile country Kenya | Show normal eligibility and claim flow |
| Signed in, profile country another country | Hide the offer or show a non-actionable country-unavailable state |
| Country-policy service unavailable | Fail the funded section closed without breaking ordinary vouchers |

The initial Kenya rollout should show an unset-profile member the locked offer
because the member can complete the requirement. A known non-Kenya member
should not see a claim CTA.

### 8.2 Required member copy

Unset profile:

> Set your profile country to Kenya to claim this offer.

CTA: **Update profile** -> `/me`

Other country:

> This offer is available only to members whose profile country is Kenya.

Successful eligibility:

> Your profile is set to Kenya.

### 8.3 Hub country resolver

Funded-voucher discovery, eligibility, and claim routes use a dedicated strict
resolver that reads only:

```text
hub_user_profiles.country_code for the authenticated hub_user_id
```

It must not call the ordinary marketplace `resolveMemberCountry` helper while
that helper retains legacy fallback behavior.

### 8.4 Legacy profile prefill

The `/me` page may use a legacy wallet country to prefill the location editor
as a migration convenience, but it must distinguish a suggested value from a
country saved on `hub_user_profiles`.

A prefilled legacy value does not satisfy the funded country gate until the
member explicitly saves it and the profile write persists `country_code`.
The UI must not display an unsaved legacy prefill as though it were the active
funded-offer country decision.

### 8.5 Claim remains authoritative

Changing the browser response, skipping the preview, or calling the claim
route directly must not bypass the Platform and database checks.

---

## 9. Platform API contract

### 9.1 Eligibility preview

`GET /api/v1/voucher-funding-allocations/:id/eligibility` returns a safe
country result derived from the current profile:

```ts
type FundedVoucherEligibilityPreview = {
  eligible: boolean;
  alreadyClaimed: boolean;
  allocationAvailable: boolean;
  requirementsRemaining: Array<
    | "profile_country_required"
    | "profile_country_mismatch"
    | string
  >;
  profileCountryCode: string | null;
  requiredCountryCode: string;
};
```

The response must not expose legacy wallet country or another linked member's
profile data.

### 9.2 Claim endpoint

`POST /api/v1/voucher-funding-allocations/:id/claim`:

- requires an authenticated Hub member;
- requires a stable idempotency key;
- does not trust a country supplied by Hub;
- invokes the atomic claim RPC, which performs the final country gate;
- maps stable database error codes to safe API responses.

### 9.3 Internal grants and automatic awards

Internal grant and automatic award endpoints must provide a real
`hub_user_id`. Wallet-only recipients are not eligible for country-funded
inventory because they do not have the required Hub profile.

The same atomic RPC and country gate are used for all claim modes.

---

## 10. Atomic database enforcement

### 10.1 Authoritative placement

The authoritative country check belongs in
`claim_akiba_funded_voucher_atomic`, after exact idempotent replay handling and
before any new voucher, claim, reservation, ledger entry, or audit row is
created.

### 10.2 Transaction sequence

For a new claim, the function performs this sequence:

1. Validate allocation, canonical member, Hub user, claim mode, and
   idempotency key.
2. Lock the allocation claim scope.
3. Load the allocation and parent program.
4. Resolve an exact idempotent replay and verify replay identity ownership.
5. Acquire the per-user country-policy advisory lock.
6. Select the exact `hub_user_profiles` row for `p_hub_user_id`.
7. Require a non-null recognized `country_code`.
8. Require equality with `voucher_funding_programs.country_code`.
9. Evaluate all other eligibility and funding invariants.
10. Create the issued voucher, claim, reservation, ledger, and audit records.

No reservation or partial record may survive a failed country check.

### 10.3 Stable errors

| Condition | Code |
|---|---|
| `p_hub_user_id` missing | `COUNTRY_PROFILE_REQUIRED` |
| Profile row missing | `COUNTRY_PROFILE_REQUIRED` |
| `country_code` null or invalid | `COUNTRY_PROFILE_REQUIRED` |
| Profile and program countries differ | `COUNTRY_NOT_ELIGIBLE` |
| Program country invalid or policy objects unavailable | `COUNTRY_POLICY_UNAVAILABLE` |
| Replay identity differs | `IDEMPOTENCY_CONFLICT` |

### 10.4 Belt-and-suspenders trigger

The existing `enforce_funded_voucher_claim_country` trigger must be replaced or
updated so it:

- resolves the exact recipient `hub_user_id` from the issued voucher linked by
  `NEW.issued_voucher_id`;
- reads `hub_user_profiles.country_code` only;
- performs no legacy `users.country` or wallet fallback;
- requires exact equality with the parent program country;
- overwrites `NEW.country_code` and `NEW.country_assurance` from authoritative
  database state;
- fails closed if any required row is missing.

The trigger protects direct service-role RPC use and future claim paths. The
atomic function remains responsible for returning clean domain error codes.

### 10.5 Concurrency

The profile update RPC and funded claim RPC use the same per-user advisory lock.
This defines a deterministic order for a concurrent profile change and claim:

- if the Kenya profile state commits first, the subsequent claim may pass;
- if a non-Kenya or unset state commits first, the subsequent claim fails;
- no claim observes a partially updated profile state.

---

## 11. Error and HTTP mapping

| Platform code | HTTP | Member copy |
|---|---:|---|
| `COUNTRY_PROFILE_REQUIRED` | 422 | Set your profile country to Kenya to claim this offer. |
| `COUNTRY_NOT_ELIGIBLE` | 422 | This offer is available only to members whose profile country is Kenya. |
| `COUNTRY_POLICY_UNAVAILABLE` | 503 | This offer is not available right now. Please try again later. |
| `IDEMPOTENCY_CONFLICT` | 409 | This claim request could not be safely replayed. Refresh and try again. |

Admin and internal APIs may include a request/debug ID. Member responses must
not expose raw database messages or other profile values.

---

## 12. Security and abuse considerations

### 12.1 Assurance level

Profile country is self-declared. Passing this gate proves only that the member
explicitly selected Kenya in their profile. It does not prove residence or
physical presence.

The recorded assurance remains `self_declared_profile`.

### 12.2 Profile switching

Country changes are audited. If abuse appears during the pilot, later controls
may add:

- a waiting period after changing into the program country;
- phone or identity assurance;
- velocity and risk review;
- a restriction table used by the `not_blocked` policy.

These controls are not part of the initial requirement and must not be inferred
silently from unrelated data.

### 12.3 Least privilege

- The browser cannot set `hub_user_id`, program country, assurance, or claim
  evidence.
- Only authenticated profile APIs may change the current user's country.
- Only service-role functions may insert funded claims.
- Admin operators cannot edit member profile country through the voucher fund
  workflow.

---

## 13. Observability and audit

Record counters for:

- funded eligibility denied because profile country is missing;
- funded eligibility denied because country mismatched;
- country policy unavailable;
- successful funded claims by program country;
- internal grant attempts rejected by the country gate;
- profile-country changes;
- idempotency conflicts.

Logs and metrics may contain program, allocation, country code, reason, and
request ID. They must not contain raw access tokens, email addresses, wallet
addresses, or full profile payloads.

Operations should alert on:

- any funded claim with `country_code IS NULL`;
- any funded claim whose stored country differs from its program country;
- any successful funded claim lacking `self_declared_profile` evidence;
- repeated `COUNTRY_POLICY_UNAVAILABLE` failures.

---

## 14. Testing requirements

### 14.1 Profile write tests

- `KE` saves as `KE`.
- `Kenya` normalizes and saves as `KE` when compatibility input is accepted.
- lowercase and surrounding whitespace normalize safely.
- supported non-Kenya countries save their correct ISO-2 code.
- blank and arbitrary free text are rejected.
- an explicit supported `Other` option, if retained, saves a non-qualifying
  null country code.
- the browser cannot change another user's profile country.
- country changes write an audit event.

### 14.2 Hub tests

- unset profile receives the update-profile requirement and CTA.
- Kenya profile receives an eligible country preview.
- non-Kenya profile receives a mismatch result and no claim CTA.
- a Kenya legacy wallet with no Hub profile remains ineligible.
- funded country lookup never invokes the legacy fallback resolver.
- a country-policy failure does not break ordinary voucher discovery.

### 14.3 Platform route tests

- self-claim with `KE` profile reaches the atomic RPC.
- unset and non-Kenya profiles return stable safe error codes.
- request-supplied country values are ignored.
- rate limiting and idempotency behavior remain intact.
- internal grants and auto awards cannot bypass the country gate.

### 14.4 Real-database tests

- Kenya profile + Kenya program succeeds.
- Kenya display-name backfill produces `KE` and succeeds.
- missing profile row fails.
- null code fails.
- `Other`/unrecognized legacy profile fails after backfill.
- Uganda profile + Kenya program fails.
- Kenya legacy wallet + unset Hub profile fails.
- another Hub user linked to the same canonical identity cannot provide the
  claimant's country.
- direct service-role invocation with forged `p_country_code='KE'` fails when
  the profile is not Kenya.
- failure creates no voucher, claim, reservation, ledger, or audit-success row.
- exact replay returns the existing voucher after a later country change.
- replay with a different member returns `IDEMPOTENCY_CONFLICT`.
- concurrent profile change and claim serialize on the shared per-user lock.
- all three claim modes enforce the same gate.

### 14.5 Regression tests

- ordinary Miles voucher purchase behavior is unchanged.
- merchant-funded loyalty offers are unchanged unless separately configured.
- issued funded vouchers remain redeemable after profile-country change.
- expiry, reversal, payable, and reimbursement accounting are unchanged.

---

## 15. Migration and rollout

1. Add `hub_user_profiles.country_code` and its ISO-2 constraint.
2. Deploy the strict supported-country normalizer/catalogue.
3. Backfill recognized existing profile values and review unrecognized counts.
4. Update `set_hub_profile_country` and the Hub profile API to write the
   canonical code under the shared per-user lock.
5. Update Platform eligibility previews to read the exact member profile code.
6. Add the country check to the atomic funded claim RPC for every claim mode.
7. Replace the current claim-country trigger and remove all legacy fallback.
8. Update Hub funded discovery and claim prechecks to use the strict resolver.
9. Update Admin to display the inherited locked country policy and stop
   emitting editable country rules for new allocations.
10. Run route and real-database suites, including concurrency tests.
11. Deploy behind the funded-voucher Admin, Hub, and Finance flags with all
    flags off.
12. Create one Kenya sandbox allocation and test unset, Kenya, and non-Kenya
    profiles end to end.
13. Enable the internal cohort before enabling founding-merchant claims.

### Rollback

If the new profile-country policy causes unexpected failures:

1. disable new funded claims using the Hub kill switch;
2. keep redemption and reimbursement active for issued vouchers;
3. do not restore the legacy wallet fallback;
4. repair profile-country data or policy code;
5. re-run the country matrix before re-enabling claims.

---

## 16. Implementation map

### MiniMiles

- `packages/hub-page/src/app/api/me/route.ts`
  - validate and persist the canonical profile country code.
- `packages/hub-page/src/lib/akiba/countryCodes.ts`
  - expose the strict supported-country catalogue and normalizer.
- `packages/hub-page/src/lib/akiba/fundedVoucherCountryEligibility.ts`
  - read the exact Hub profile only; remove legacy fallback.
- `packages/hub-page/src/app/api/voucher-funding/[allocationId]/eligibility/route.ts`
  - map strict preview states.
- `packages/hub-page/src/app/api/voucher-funding/[allocationId]/claim/route.ts`
  - preserve the precheck for UX while relying on Platform authorization.
- `packages/hub-page/src/lib/akiba/voucherFundingEligibility.ts`
  - add copy for required and mismatched profile country.
- `packages/admin-dashboard/src/components/vouchers/AllocationForm.tsx`
  - show the inherited locked country gate; stop treating it as an editable
    rule.
- `supabase/migrations/076_funded_voucher_country_guard.sql`
  - supersede with a new migration; do not edit the deployed migration.

### Akiba-Platform

- `packages/api/lib/voucherFunding/eligibility.ts`
  - read canonical `country_code`, normalize consistently, and remove raw
    display-name comparison.
- `packages/api/app/api/v1/voucher-funding-allocations/[id]/claim/route.ts`
  - map stable country errors and rely on the atomic country gate.
- `packages/api/app/api/v1/internal/voucher-funding-allocations/[id]/grants/route.ts`
  - require a real Hub user and apply the same gate.
- a new forward-only Supabase migration
  - add/backfill the profile code, update the profile RPC, harden
    `claim_akiba_funded_voucher_atomic`, and replace the claim trigger.

---

## 17. Definition of done

This policy is complete only when:

- every Kenya-funded allocation inherits a non-removable Kenya profile gate;
- country is stored and compared canonically as ISO-2;
- unset, `Other`, invalid, and non-Kenya profiles cannot create a new claim;
- legacy wallet country and linked-account profile fallback are impossible;
- self-claim, internal grant, and auto-award paths share the same atomic check;
- a forged API or RPC country value cannot bypass database state;
- exact idempotent replay remains reliable after profile changes;
- failed checks create no financial reservation or partial record;
- the Hub provides a direct profile-update path for unset members;
- already-issued vouchers continue through redemption and reimbursement;
- all route, database, concurrency, and regression tests pass;
- the Kenya sandbox matrix is verified with production-equivalent feature
  flags before founding-merchant launch.
