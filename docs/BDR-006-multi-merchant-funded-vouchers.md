# BDR-006 — Funded vouchers redeemable across a chosen set of merchants

**Status:** Accepted
**Date:** 2026-10-28
**Decision owner:** Ibrahim
**Relates to:** [BDR-001](BDR-001-value-gifting-funding-model.md) §4.2 (collections do
not get their own funding model), [BDR-005](BDR-005-funded-voucher-function-ownership.md)
(where these functions live)

---

## 1. Why this record exists

Akiba wants a voucher an operator can point at several merchants at once — the
first case being a market or event where a dozen traders all honour the same
offer, and the member should not have to collect a dozen vouchers.

The voucher engine was built single-merchant, deliberately and pervasively.
BDR-001 also considered multi-merchant value and rejected it. This record
exists so the next person can see that the rejection in BDR-001 and the
acceptance here are about two different things, rather than concluding that
someone forgot.

## 2. What BDR-001 actually rejected

BDR-001 rejected **pooled prepaid value** redeemable across unaffiliated
merchants: the buyer pays Akiba, Akiba holds the liability, the recipient
spends it anywhere. Its reasons were custody of customer funds, a segregated
trust account, inter-merchant clearing, and a float between a collection rail
and a payout rail that do not exist.

Its §4.2 table resolves the collection problem with: **"Resolve the merchant
before money moves."**

A multi-merchant *funded discount entitlement* has none of those properties:

| BDR-001's concern | Applies here? |
|---|---|
| Akiba holds customer funds | **No.** The member pays nothing. There is no balance. |
| Prepaid liability / trust account | **No.** The exposure is a bounded reimbursement already authorised against a fund. |
| Inter-merchant clearing or float | **No.** The till resolves exactly one merchant, and the payable is created for that merchant alone. |
| Needs a collection rail | **No.** Nothing is collected. |
| Dormancy / unclaimed value | **No.** An unredeemed voucher expires and the reservation is released back to the fund. |

So this satisfies §4.2 rather than contradicting it: **the choice spans the
set, the money does not.** The merchant is resolved at redemption, which is
strictly before any payable exists.

What BDR-001 said about collections — that they are "discovery and
merchandising" and that funding stays merchant-specific — also still holds.
Funding here is per *allocation*, and settlement is per *redeeming merchant*.

## 3. What the engine assumed

Single-merchant is not one check. Verified across both repositories:

- **Enforcement points:** roughly a dozen partner-equality gates across
  redemption, presentation/inspection, settlement, payout and legacy order
  placement.
- **Schema:** `spend_voucher_templates.partner_id`,
  `voucher_funding_allocations.merchant_id` and `issued_vouchers.merchant_id`
  are all single, and `trg_vfa_template_merchant` actively enforces that the
  allocation and its template agree.
- **Contracts:** `FundedOffer.merchant` is one object, in the hub-page type
  and in the mobile app's Zod schema.

Only two of those gates are live for the current till:

| Function | Where | Role |
|---|---|---|
| `redeem_kes_voucher_and_award_atomic` | Akiba-Platform 120 | the redemption |
| `inspect_kes_voucher_presentation` | Akiba-Platform 086 | the scan preview |

`redeem_voucher_in_store_atomic` and `inspect_voucher_presentation`
(MiniMiles 004) are the retired non-KES path. No application code calls them —
only integration tests do. They are **left single-merchant on purpose**: a
multi-merchant voucher presented to that path fails closed rather than
redeeming under rules nobody widened.

## 4. Decision

**An allocation may name additional merchants. The eligible set is
`{allocation.merchant_id} ∪ voucher_allocation_merchants`, snapshotted at
claim time, and the till accepts any merchant in that snapshot.**

### 4.1 One computed definition, not two stored ones

`voucher_funding_allocations.merchant_id` stays, unchanged and still NOT NULL.
It is the allocation's **primary** merchant: the one shown as the offer's home
in discovery, and the one the existing consistency trigger keeps aligned with
the template.

Additional merchants live in a new `voucher_allocation_merchants` table. The
eligible set is always *computed* as the primary plus that table's rows, in one
function, so the two cannot drift. The alternative — storing the full set in
the table and hoping it keeps containing the primary — adds a second source of
truth and a trigger to defend it.

### 4.2 The claim snapshot is the authority at redemption

`issued_vouchers.rules_snapshot` already decides the benefit at the till, and
it gains `eligible_merchant_ids`.

**Membership is editable only while the allocation is draft.** Once it is
submitted, approved or published, the set is part of what the approver signed
off and cannot change; changing participants means a new allocation. There is
no live membership editing in this release.

The snapshot guarantees below therefore describe *runtime semantics* — what
the till does with a voucher given some set — not an operator workflow. They
matter because a voucher outlives the row it came from:

- A voucher is judged against the set recorded when it was claimed, never the
  allocation's current set. So if a set ever did change, by migration,
  correction or a future release that permits it, vouchers already issued are
  unaffected.
- Deleting a membership row does not invalidate vouchers already issued, which
  would otherwise strand a member holding a voucher a trader had agreed to
  honour.

This matches how the engine already treats the snapshot and keeps every
redemption auditable against the rules that existed when the member claimed.
The operational consequence — name every participating merchant before
submitting for approval, not during the event — is a runbook item, not a code
one.

### 4.3 `no_prior_merchant_redemption` means none of them

The rule reads "no previous redemption at this merchant", which is ambiguous
once there are several. It is evaluated against the **whole eligible set**: a
member who has redeemed at any merchant in it does not qualify.

That matches the rule's purpose — it exists so a funded offer buys new
customers rather than subsidising regulars — and it is the conservative
reading, since the looser one would let a regular of stall A claim and spend
at stall A.

### 4.4 Mobile stays behind a flag

`FundedOffer` gains a `merchants` array while keeping `merchant` as the
primary, so the shape is additive. But an older app build would then render a
six-merchant voucher as belonging to one merchant — wrong rather than broken,
which is worse in a customer's hand than absent.

Multi-merchant offers are therefore withheld from `/api/v1/*` by the same
mechanism already used for percentage offers (`fundedOffersForV1`), until an
app release can present them.

### 4.5 Where it lives

| Migration | Contents |
|---|---|
| Akiba-Platform 154 | `voucher_allocation_merchants`, `voucher_allocation_eligible_merchants()`, the shared `voucher_redeemable_by_partner()` gate, the widened `inspect_kes_voucher_presentation` and `redeem_kes_voucher_and_award_atomic`, and `set_voucher_allocation_merchants_atomic()` |
| MiniMiles 113 | the snapshot trigger, and `no_prior_merchant_redemption` widened in the claim RPC and the claim-insert audit trigger |

Apply 154 before 113: everything in 113 calls
`voucher_allocation_eligible_merchants()`, so the reverse order cannot
compile. Applying 154 alone is inert — no snapshot carries a set yet, so the
gate falls back to single-merchant equality for every voucher in flight.

The snapshot is written by a BEFORE INSERT trigger on `issued_vouchers`
rather than inside the claim RPC, following the pattern migration 112
established for redemption schedules. A later migration that redefines the
claim RPC from an older copy would silently drop a field added inside it —
the BDR-005 failure mode — whereas a trigger survives that. 112's trigger and
this one both merge with `||` and each touches only its own key, so they
compose in any firing order; an integration test asserts a voucher carries
both.

## 5. What this does not do

- No pooled balance, no stored value, no partial redemption. A voucher is
  still single-use and still resolves to exactly one merchant.
- No change to who may redeem beyond the merchant set: every redeeming
  merchant still needs a `partner_subscriptions` row in
  `('trialing','active','past_due')`, which is what makes Miles awarding and
  reimbursement attributable. Adding a trader to a voucher's merchant set does
  **not** onboard them.
- No change to the retired non-KES redemption path.

## 6. What would reverse this

If a future offer needs value rather than a discount — a balance that draws
down across merchants — that is BDR-001's Option A again and this record does
not authorise it. The distinction to preserve is that nothing here is prepaid
and nothing is pooled.
