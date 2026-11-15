# BDR-008 — New-user welcome offer: automatic award on the funded-voucher engine

**Status:** Accepted
**Date:** 2026-11-10
**Decision owner:** Ibrahim
**Relates to:** [new-user-welcome-offer-spec](new-user-welcome-offer-spec.md) (the
product spec this narrows), [BDR-006](BDR-006-multi-merchant-funded-vouchers.md)
(multi-merchant set and claim snapshot), [BDR-007](BDR-007-onboarding-intro-and-permission-primers.md)
(the native onboarding that awards it)

---

## 1. Why this record exists

The welcome offer is the first voucher Akiba gives a member **without them
claiming it**. The funded-voucher claim RPC has carried an `auto_award` mode
since migration 098 and has refused it every time since ("deliberately disabled
until their trigger and actor contracts are implemented" — 098, 110, 113).
This record is that contract, so the mode is switched on for one narrow trigger
rather than generally.

It also records three choices that narrow the 7 November spec.

## 2. The offer

- **25% off, capped at KSh 250, on a bill of at least KSh 1,000** — so every
  use saves the full KSh 250 (see §6.2).
- **One use**, valid **7 days** from issue.
- **First 1,000 eligible new sign-ups.** The cap is configuration, not code: it
  can be raised later together with a matching budget top-up.
- **Akiba-funded.** The member pays the discounted total; the redeeming
  merchant is reimbursed the actual discount through the existing payable.

## 3. Decisions

### 3.1 "First welcome redemption", not "strict first purchase"

The spec's strict reading — any undiscounted first purchase cancels the offer —
needs one first-purchase gate across every purchase path in both repositories,
and the spec itself lists failing to guarantee that as a launch blocker.

**Chosen:** the voucher is usable on any one purchase within its 7 days,
whether or not the member has already bought something without it.

*Rejected:* strict first purchase — more enforcement surface than the
acquisition goal needs, and a member who pays full price once by mistake
loses the offer that brought them in.

*Public copy follows:* "25% off a purchase in your first 7 days", not
"your first purchase".

### 3.2 Merchants: every ready merchant, frozen at approval

"Any store" is implemented as **every merchant that is ready for KES checkout
and reimbursement** (an active `partner_subscriptions` row in
`('trialing','active','past_due')`) when the campaign's allocation is approved.
Under BDR-006 that set is then frozen and snapshotted onto each voucher at
issue. Merchants onboarded later join through a **new allocation** for later
sign-ups; vouchers already issued keep their set.

Public copy says "participating places", never "any store", because the set is
not literally every merchant in the directory.

### 3.3 Awarded at onboarding completion, shown only once committed

Enrolment happens inside native onboarding completion, in one transaction:
check campaign state and capacity → check the member is new and not already
enrolled → reserve KSh 250 from the allocation budget → issue the voucher via
the claim RPC in `auto_award` mode → record the enrolment. Any failure rolls
the whole thing back; onboarding completion itself still succeeds without an
offer.

The app shows the voucher **only** when that call returns an issued offer.
The client flag built in BDR-007 (`welcomeVoucher`) is replaced by this server
result, because a flag would show "25% OFF" to the 1,001st member too.

The 7-day clock starts at issue (the claim RPC's existing
`voucher_validity_seconds`), not at account creation. Onboarding completion is
usually minutes after sign-up; anchoring to issue keeps one expiry rule for
every funded voucher.

### 3.4 What `auto_award` is allowed to do

Only the welcome enrolment function may call the claim RPC with `auto_award`,
and only for an allocation linked to an `active` welcome campaign. The actor is
recorded as the system enrolment, never a member or operator. Every other
caller still gets `CLAIM_MODE_NOT_ENABLED`.

## 4. New member

New = a canonical Akiba member whose account was created while the campaign is
enrolling, with no existing welcome enrolment. One enrolment per canonical
identity (unique), so reinstalling, signing out and in, or linking another
sign-in method cannot earn a second voucher. Web-only onboarding does not
enrol (native channel only, per the spec).

## 5. What this does not do

- No balance, no cashback, no partial use — still a single-use discount.
- No new reimbursement ledger: realised discounts flow through the existing
  payable to the redeeming merchant.
- Expired and unused vouchers release their reservation as today; freed slots
  are **not** reassigned (keeps "first 1,000" literal).

## 6. Amendments from implementation (2026-11-10)

Built in migration 126 and `/api/v1/me/welcome-offer`. Two points changed:

1. **Awarded on reaching the last onboarding step, not inside completion.**
   Completing onboarding immediately sends the app home, so the Pass-ready
   screen could never show an offer issued by that call. The app instead
   calls `POST /api/v1/me/welcome-offer` when the member reaches Pass ready.
   The same rules apply: one database transaction, new-member check, cap,
   one per canonical identity, and a committed voucher before anything is
   shown. Onboarding completion is unchanged.
2. **A minimum spend is required.** The funded engine refuses a percentage
   offer whose minimum spend is not above its cap (Akiba-Platform 151), so
   "no minimum spend" cannot be configured. The minimum is allocation
   configuration, not code. **Decided (2026-11-11): KSh 1,000**, the bill
   at which 25% reaches the KSh 250 cap. Public copy states it: "25% off,
   up to KES 250, on a bill of KES 1,000 or more".

The campaign row (`welcome_offer_campaigns.state = 'enrolling'`) is the on/off
switch. The welcome allocation is `auto_award` only; the Hub never lists it
as a claimable offer.

## 7. What would reverse this

- Abuse through new accounts (one person, many emails): add a verification
  step or device signal — a separate product decision.
- If marketing needs "first purchase" literally, §3.1 is reopened and the
  cross-channel gate becomes a launch blocker again.
