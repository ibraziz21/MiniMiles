# BDR-005 — Funded-voucher claim functions: one owner, one file

**Status:** Accepted
**Date:** 2026-10-25
**Decision owner:** Ibrahim
**Scope:** the funded-voucher eligibility rule vocabulary — six definitions
across three packages and two repositories (enumerated in §3.1)

---

## 1. Why this record exists

Three database functions that together authorize every Akiba-funded voucher claim
were defined across two repositories, against one Postgres project. Adding a
percentage benefit and a weekend-only claim rule required changing all three, and
the split made it genuinely hard to answer "where do I edit this?" — with a wrong
answer that applies cleanly and does nothing.

This record exists so the next person does not have to re-derive the ownership
from commit dates.

## 2. What the situation was

`claim_akiba_funded_voucher_atomic` is created or replaced by:

| Repository | Migration | Committed |
|---|---|---|
| Akiba-Platform | 118, 126, 147, 148 | 2026-10-04 |
| MiniMiles | 098 | 2026-10-14 |

Both run against the same database. MiniMiles 098 was authored later and its
own header states it is "a forward-only replacement for the Platform
phase-one claim function"; it also carries 148's hardening (identity pairing,
idempotency-conflict detection, country policy, reservation ledger) forward,
so it is a successor rather than a fork.

**The dates above are commit dates — authoring order, not apply order.** They
are the reason to believe MiniMiles owns this function, not proof of it. Which
definition is actually live in a given environment must be read from that
database:

```sql
SELECT pg_get_functiondef(oid)
  FROM pg_proc
 WHERE proname = 'claim_akiba_funded_voucher_atomic';
```

The two eligibility trigger functions were only ever defined in Akiba-Platform
149, and they both independently enumerate the rule-type vocabulary:

- `validate_funded_voucher_rule_set_row` allow-lists rule types on INSERT into
  `voucher_eligibility_rule_sets`;
- `enforce_funded_voucher_claim_eligibility_audit` re-evaluates every rule on
  INSERT into `voucher_claims`, and its `ELSE` branch treats an unrecognised
  type as unavailable policy.

So the vocabulary lived in three functions across two repositories, and the two
failure modes are asymmetric and both silent-looking:

- a type in the allow-list but missing from an evaluator → every claim on that
  allocation fails with `ELIGIBILITY_POLICY_UNAVAILABLE`, which reads as "no one
  is eligible", not "unhandled branch";
- a type in the evaluators but missing from the allow-list → the rule set cannot
  be created at all.

## 3. What this cost in practice

Two real defects, both found while making this change:

1. **`no_prior_merchant_redemption` had never worked.** It referenced
   `voucher_redemptions.merchant_id` unqualified, and `merchant_id` is also a
   `RETURNS TABLE` output column of the claim RPC — which PL/pgSQL puts in scope
   as a variable for the whole body. Every claim against an allocation using
   that rule raised SQLSTATE 42702. Platform 126 exists solely to fix this class
   of bug (it renamed the `allocation_id` output to `out_allocation_id`);
   `merchant_id` kept its name and this one reference was missed. The rule is
   the one that makes a funded offer customer acquisition rather than a discount
   for existing regulars, so it mattered.

2. **The claim-time rules snapshot was incomplete for percentage benefits.** The
   till (`redeem_kes_voucher_and_award_atomic`, Platform 120) reads the benefit
   from `issued_vouchers.rules_snapshot` and raises
   `INVALID_PERCENT_VOUCHER_SNAPSHOT` without `discount_percent` and
   `maximum_discount_kes`. The snapshot copied neither, so a percentage funded
   voucher would have been claimable and then unredeemable at the counter.

Neither is a consequence of the split on its own. But the split is why the second
evaluator was easy to overlook, and why nothing tied "the till needs these two
fields" to "the claim writes this snapshot".

## 3.1 The vocabulary is in six places, not three

The first version of this record said three, and the first attempt at the
weekend rule shipped with two of the six missing. An audit caught it before
release. The complete list:

| # | Definition | Where | Effect if a rule type is missing |
|---|---|---|---|
| 1 | `claim_akiba_funded_voucher_atomic` | MiniMiles 110 | Claim fails closed |
| 2 | `validate_funded_voucher_rule_set_row` | MiniMiles 110 | Rule-set row cannot be inserted |
| 3 | `enforce_funded_voucher_claim_eligibility_audit` | MiniMiles 110 | Every claim raises `ELIGIBILITY_POLICY_UNAVAILABLE` |
| 4 | `create_voucher_eligibility_rule_set_atomic` | Akiba-Platform 152 | Operator cannot create the rule: `UNSUPPORTED_ELIGIBILITY_RULE_TYPE` |
| 5 | `packages/api/lib/voucherFunding/eligibility.ts` | Akiba-Platform | Preview and claim both rejected before Postgres is reached |
| 6 | `ELIGIBILITY_RULE_TYPES` | MiniMiles admin-dashboard | Rule is not offered in the authoring UI |

What made (4) and (5) easy to miss is instructive, because it was not
carelessness about the list:

- (4) is a *second* allow-list, distinct from (2). The row trigger accepts the
  rule, so inserting a rule-set row directly works — and the integration suite
  did exactly that, so it passed. The Admin Dashboard does not insert rows; it
  calls the RPC. The test and the operator took different paths through the
  same feature.
- (5) is in TypeScript, in another repository, and is the *first* thing a
  customer claim touches. The database being entirely correct is not
  observable to anyone if this rejects the rule first.

The general lesson: this feature has four journeys — migration, authoring,
customer claim, and discovery — and passing database tests only evidences the
first. Each of the other three has its own gate.

## 4. Decision

**MiniMiles owns the three claim-path functions, which live in one migration
file; the remaining three definitions stay where their chains are, and a test
enforces that all six agree.**

One file was never going to be achievable for all six: (5) is application code
in another repository and (6) is the authoring UI. Consolidating what could be
consolidated and *testing* the rest is the honest version of this decision.

MiniMiles `supabase/migrations/110_funded_percent_vouchers_weekend_claims.sql`
redefines the claim RPC and both trigger functions together. Akiba-Platform 149's
versions are carried forward unchanged apart from the new rule type.

Reasons, in order of weight:

1. The claim RPC was already live from MiniMiles. Continuing the chain in
   Akiba-Platform would mean shipping a migration that applies cleanly and has
   no effect — the worst available failure mode.
2. The allocation-authoring UI and API (`packages/admin-dashboard`) are in
   MiniMiles, so the operator-facing half of any eligibility rule is here.
3. The rule vocabulary is one thing. Keeping its three definitions in one file
   makes drift visible in review instead of discoverable in production.

### 4.1 What stays in Akiba-Platform

Benefit *authoring* and *redemption* remain Platform-owned, because that is
where their chains live and neither has a competing MiniMiles definition:

- `create_voucher_funding_allocation_atomic` /
  `update_voucher_funding_allocation_draft_atomic` — Platform 151
- `redeem_kes_voucher_and_award_atomic` — Platform 120

A change to the benefit shape therefore still spans both repositories. That is
accepted for now: splitting authoring from claiming is a coherent line, whereas
splitting the claim path from its own eligibility triggers was not.

### 4.2 Guard

`packages/hub-page/src/__tests__/fundedEligibilityRuleVocabulary.test.ts` reads
all six definitions — across both repositories — and asserts they agree: every
authorable rule type is handled by every evaluator, no evaluator handles an
authorable-looking type that is not authorable, and the two authoring
allow-lists and the admin UI list match exactly. It was verified to fail by
removing `claim_day_of_week` from the Platform API evaluator.

No integration test can cover that invariant: asserting it requires a rule
type deliberately absent from one of the six, which is the bug itself. When the
Akiba-Platform checkout is missing, the test reports the two Platform
definitions as unverified rather than passing silently.

Behaviour is covered by
`packages/hub-page/src/__tests__/integration/funded-percent-weekend-claims.test.ts`,
which replays the real Platform migration sequence followed by 110 against a
disposable Postgres database. It creates rule sets through
`create_voucher_eligibility_rule_set_atomic` rather than inserting rows — the
earlier direct-INSERT version is what let blocker (4) through, and the suite
was verified to fail with `UNSUPPORTED_ELIGIBILITY_RULE_TYPE` when migration
152 is withheld.

Discovery is covered by
`packages/hub-page/src/__tests__/lib/vouchers/fundedOfferMapping.test.ts`, over
the single mapper both funded-offer loaders now share. They previously each
carried their own copy of the select list and the validity check, and both
copies dropped any offer with a null `discount_kes` — which is every
percentage offer.

## 5. What would change this

If the funded-voucher claim path moves back to Akiba-Platform wholesale — for
instance because the Platform API becomes the only caller — then this record is
superseded, and the move should carry all three functions together rather than
leaving the vocabulary split again.
