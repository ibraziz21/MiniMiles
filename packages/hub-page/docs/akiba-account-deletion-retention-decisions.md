# Account deletion — retention decision sheet

- **Blocks:** AKIBA-MOB-002 §9, and therefore account deletion processing
- **Owners:** Akiba data-protection owner (all rows), finance (settlement and
  prize rows), product (published content)
- **Source of truth:** `packages/hub-page/src/lib/akiba/accountDeletionPolicy.ts`
- **Last reviewed:** 2026-10-10

---

## What this document is for

`DELETION_INVENTORY` has 21 rows. **14 are unapproved** — their `retention`
is `null` — and `assertInventoryApproved()` throws while any of them is, so
no member data can be deleted in any environment. The acceptance path is
gated on the same condition, so requests are *refused* rather than accepted
and stranded.

This sheet exists because the reasoning for each row currently lives in code
comments, which is not a form a data-protection owner can sign. Each section
below gives the schema facts, the realistic options, and what each option
implies for the code — so the decision can be made once and recorded.

**Decide §A first.** Those three rows are not retention-period questions.
The database makes a plain delete impossible, so the decision determines
whether an executor can exist at all, and they gate the whole discovery
subgraph plus Pass deletion. The eleven rows in §B can be reviewed as a
batch.

### How a decision gets recorded

Replace the row's `retention: null` with the full `RetentionTerms` object.
Every field is required — §9 names all ten, and a test asserts no approved
row leaves any of them blank:

```ts
retention: {
  purpose: "…",                     // why Akiba keeps it at all
  lawfulBasis: "…",                 // under the Kenya Data Protection Act
  periodDays: 2555,                 // exact, not "as long as necessary"
  fieldsRetained: ["…"],            // after pseudonymisation
  pseudonymizationMethod: "…",      // e.g. "hub_user_id → HMAC, contact nulled"
  accessRoles: ["…"],               // who may read it
  processor: "Supabase (Akiba project)",
  storageRegion: "…",
  reviewCadence: "annual",
  endOfPeriodAction: "…",           // delete, or anonymise further
},
```

Changing a row also means bumping `DELETION_POLICY_VERSION`, because the
member acknowledges a specific version at confirmation and the request API
accepts only the current one. The privacy policy states that same version
(asserted by `src/__tests__/lib/legalContent.test.ts`), so the copy and the
code move together.

---

## §A — Schema-bound rows: decide these first

These three cannot be resolved by naming a period. A foreign key the
database will enforce stands in the way, so the decision is *what the code
should do*, and the answer changes which executor gets written.

### A1. `published_photos` — published member photos and contributions

- **Tables:** `photo_processing_jobs`, `merchant_discovery_contribution_items`,
  `merchant_visit_photos`, `merchant_discovery_contributions`
- **Spec default (§9):** "Delete by default. An exception requires approved
  purpose and disclosure."
- **Why the default is impossible:**
  `discovery_moderation_audit_events.photo_id` is `NOT NULL REFERENCES
  merchant_visit_photos(id)` with no `ON DELETE` action, and that table is
  documented in `090_verified_discovery_hardening.sql` as the authoritative
  append-only moderation record that "cannot be updated or deleted through
  any application role". A moderated photo's row therefore cannot be deleted
  without destroying the moderation evidence.

| Option | What the executor does | Trade-off |
|---|---|---|
| **A1-a** Keep every photo row, pseudonymise it | Null `hub_user_id`-equivalent linkage and the storage keys; keep the row | Uniform and simple; retains a content row for every member, which must be disclosed |
| **A1-b** Delete rows with no moderation audit, pseudonymise the rest | Two paths, decided per photo | Deletes more; the executor and its tests are more complex, and behaviour differs between members |
| **A1-c** Allow deleting moderation audit rows for a deleted member | Delete the whole subgraph | Contradicts the append-only design decision in 090; needs that decision reversed in writing |

**Note:** the image bytes go in every option. `member_photo_objects` is
already approved and runs first, deleting the Storage objects in both
buckets before any row is touched.

**Needs:** a choice of a/b/c; if a or b, the retention terms for the kept
rows and the disclosure wording for the privacy policy.

---

### A2. `unpublished_contributions` — in-flight discovery answers

- **Tables:** `merchant_discovery_item_mentions`,
  `discovery_contribution_requests`
- **Why it is blocked:** chained behind A1.
  `merchant_discovery_contributions.request_id` and
  `merchant_visit_photos.contribution_id` are both `NOT NULL` with no
  `ON DELETE` action, so the request row cannot be deleted while any
  contribution or photo row survives.
- **Consequence:** if A1 resolves to **A1-a** (keep every photo row), the
  request rows can never be deleted either, and this row becomes a
  pseudonymise decision too. If A1 resolves to **A1-b** or **A1-c**, this
  row can be a plain delete for the affected members.

**Needs:** nothing independent — it follows A1. Record it explicitly anyway
so the inventory has no implicit decisions.

---

### A3. `pass_credentials` — Akiba Pass and presentation secrets

- **Table:** `hub_user_passes`
- **Spec default:** delete. No valid Pass credential may survive processing,
  and nothing about that is in question.
- **Why it is blocked:** `hub_referrals.referred_pass_id` is
  `NOT NULL REFERENCES hub_user_passes(id)` with no `ON DELETE` action. A
  referred member's Pass row cannot be deleted while their referral row
  exists — so this row cannot be resolved before `referrals` (B6).

| Option | What the executor does | Trade-off |
|---|---|---|
| **A3-a** Delete the member's referral rows, then the Pass | Referrals deleted in the preceding step | Simplest; loses referral history for both parties, including the *other* member's record of it |
| **A3-b** Keep referrals pseudonymised, make `referred_pass_id` nullable | Needs a forward migration altering the column, then null it | Preserves referral evidence; one more migration, and the column's `NOT NULL` guarantee is lost for everyone |
| **A3-c** Keep referrals and the Pass row, pseudonymise both | Pass row retained with its secrets destroyed | Avoids a migration, but leaves a Pass row for a deleted account — needs care that no credential remains usable |

**Needs:** a choice, taken together with B6. If A3-b, a migration is in
scope for the implementation step.

---

## §B — Purpose and period rows: reviewable as a batch

Each of these has a clear action already; what is missing is the lawful
basis, the exact period, and which fields survive pseudonymisation. None of
them blocks another.

| # | Row | Tables | Proposed action | The question for legal/finance |
|---|---|---|---|---|
| B1 | `active_vouchers` | `issued_vouchers`, `voucher_claim_intents` | Void, retain audit | How long must issuance and redemption audit survive a voided voucher? |
| B2 | `reward_ledger` | `miles_ledger_holds`, `miles_spend_intents` | Pseudonymise | Accounting period, and which fields stay once the member link is cut |
| B3 | `settlement_evidence` | `voucher_redemptions`, `voucher_purchase_quotes`, `mpesa_stk_requests` | Pseudonymise | Statutory accounting period; M-Pesa evidence may carry its own minimum |
| B4 | `earning_events` | `verified_earning_events`, `hub_quest_action_proofs`, `hub_user_canonicals` | Pseudonymise | Fraud/settlement purpose, and whether the canonical identity mapping is cut or kept |
| B5 | `fraud_risk` | `hub_user_risk_flags`, `identity_merge_incidents`, `hub_profile_country_audit` | Pseudonymise | Period and the restricted-access roles. Retaining this is the normal outcome, not an exception |
| B6 | `referrals` | `hub_referrals`, `hub_referral_codes`, `referral_reward_jobs` | Pseudonymise | Must not expose the deleted member to either party. Decide **with A3** |
| B7 | `skill_game_prizes` | `skill_game_leaderboard_prize_deliveries` | Pseudonymise | Prize/settlement evidence period. **Found by the static foreign-key check, not by hand** — it references `auth.users` and blocks Auth deletion |
| B8 | `notification_history` | `notification_outbox` | Delete | Is any row transaction evidence? Delivery addresses are never retained either way |
| B9 | `analytics` | external processors | Processor deletion | Which processors exist, each one's deletion API, and the SDK identifiers actually in the binary. Today `track()` has no provider wired, so this may be "none" |
| B10 | `onchain` | Celo | Cannot be deleted | Disclosure wording only. Already drafted in privacy §9 — confirm it |
| B11 | `deletion_record` | `account_deletion_requests`, `account_deletion_events` | Pseudonymise | Evidence period for proving a request was made and honoured |

Three of these need no engineering once decided (B9 if there is no provider,
B10, and B11 if the period is simply "indefinite as evidence"). The other
eight each need an executor plus integration coverage.

---

## After the decisions

For every row that moves to approved:

1. Fill in `RetentionTerms` in `accountDeletionPolicy.ts`.
2. Write the executor in `accountDeletionWorker.ts`. A missing executor is a
   **failure** (`step_executor_missing`), never a skip, so an approved row
   with no code will stop processing rather than silently retain data.
3. Place it in `STEP_ORDER` consistent with the foreign-key graph.
   `accountDeletionStepOrder.test.ts` parses the real migrations and fails if
   a parent would be deleted before a child, or if an approved row still has
   an unhandled dependent.
4. Add integration coverage in
   `src/__tests__/integration/account-deletion-workflow.test.ts` against real
   Postgres. Mocked tests cannot see a constraint; they already hid three
   ordering defects and an ambiguous plpgsql reference on this feature.
   The residue harness (`src/lib/akiba/accountDeletionVerification.ts`) is
   already built and tested, so grading a new executor is
   `collectResidue(sql, userId)` before and after, then `assertNoResidue`.
   It derives its table list from the inventory, so a new data class is
   covered as soon as it is added here — and it reports tables it *cannot*
   count (reached through a join, or absent from the database) rather than
   passing them, so the release evidence states its own blind spots.
5. Bump `DELETION_POLICY_VERSION` and update privacy §9 in **both**
   `hub-page/src/content/legal.ts` and `website/src/content/legal.ts`.
6. Only then set `ACCOUNT_DELETION_SUBMISSION_ENABLED` and
   `ACCOUNT_DELETION_PROCESSING_ENABLED`.

### Completion email

The transport is implemented and off by default
(`src/lib/akiba/accountDeletionEmail.ts`). Two variables turn it on:

```text
ACCOUNT_DELETION_EMAIL_PROVIDER=resend
RESEND_API_KEY=…
ACCOUNT_DELETION_EMAIL_FROM=Akiba <no-reply@…>   # optional
```

With no provider set the worker skips the delivery pass rather than burning
retry attempts, and `account_deletion_reconciliation.completion_email_pending_count`
shows the backlog. The internal worker route reports
`completionEmailProvider: null` so that backlog is self-explaining.

Resend is the first adapter because it is one authenticated POST with no SDK,
which keeps this package dependency-free for email. Choosing a different
provider means adding an adapter of about the same size to `ADAPTERS` — the
worker's contract does not change. The remaining decision is operational:
which provider, whose account, and which verified sending domain (it must
match the canonical production host, which is itself still open).

Until step 6, the member-facing behaviour is honest: the app and
`/account-deletion` both show the support fallback instead of a Continue
button, and nothing is accepted that cannot be carried out.
