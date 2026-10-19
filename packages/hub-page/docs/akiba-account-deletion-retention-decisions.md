# Account deletion — retention decision sheet

- **Blocks:** AKIBA-MOB-002 §9, and therefore account deletion processing
- **Owners:** Akiba data-protection owner (all rows), finance (settlement and
  prize rows), product (published content)
- **Source of truth:** `packages/hub-page/src/lib/akiba/accountDeletionPolicy.ts`
- **Last reviewed:** 2026-10-19

## Decision log — 2026-10-19

### Photos and contributions: product direction accepted

The user accepted the following recommended behavior in the release-readiness discussion:

- Delete all uploaded source images, thumbnails and display copies.
- Remove the member's contributions from public view.
- Delete photo/contribution records without a moderation-audit dependency.
- Where moderation evidence must survive, keep only the minimum restricted internal evidence; remove member linkage, content and storage keys. Inspect the audit payload itself for identifiers/content as well as its referenced rows.
- Delete associated draft/request records where dependencies permit. Minimize and restrict any parent records that retained evidence still requires; do not assume A1-b permits deleting every request row.

This selects **A1-b**, with **A2 following per retained dependency chain**. It authorizes this implementation direction, not a blanket approval of retention. The exact retention period, lawful basis, retained field allowlist, access roles, storage region, expiry mechanism and legal disclosure remain unresolved. Keep `retention: null` and deletion submission/processing gates closed until those terms and the required executors/migrations are complete and verified.

Implementation must reconcile this direction with the append-only moderation audit design. Do not silently retain identifying audit payloads or rewrite append-only evidence; explicitly resolve any schema conflict before enabling processing.

### Pass and referrals: product direction accepted

The user accepted the following recommended behavior:

- Delete the member's Pass and invalidate its credentials.
- Disable their referral codes and cancel pending referral rewards.
- Preserve only minimal evidence of completed referral rewards for reconciliation, removing the deleted member's identity and preventing either party from viewing the deleted member's identity through referral history.
- Migrate the database so retained referral evidence does not require the deleted Pass (`A3-b`: make `referred_pass_id` nullable and detach the reference before Pass deletion). Review all other member references and constraints as part of implementation.

This resolves the product direction for **A3 / B6**. The exact retained field allowlist, retention period, lawful basis, restricted access roles and expiry mechanism remain pending. Do not mark these inventory rows approved or enable processing on this decision alone. Verify credential invalidation, both sides of referral visibility, pending reward cancellation and completed reward evidence in integration tests.

### Vouchers, Miles and financial evidence: product direction accepted

The user accepted the following recommended behavior for **B1–B4 / B7**:

- Revoke unused vouchers so they cannot be redeemed.
- End access to the deleted account's Miles balance; cancel pending spending and release holds. Reconcile in-flight or already committed transactions before releasing anything to avoid double spending or altering completed settlements.
- Preserve only restricted evidence of completed earning/redemption needed for reconciliation; remove unnecessary personal details and the ordinary member identity linkage.
- Preserve required payment and merchant-settlement accounting evidence. Account deletion must not erase amounts owed to merchants or other parties.
- Apply the same evidence-minimization approach to completed prize deliveries.
- Permit deletion despite an existing Miles balance or unused vouchers; disclose the loss of access before confirmation.

These are accepted product behaviors, not approved financial retention terms. Finance/data protection still need to specify lawful bases, exact periods and their start events, retained field allowlists (including any legally necessary identifiers), access roles, treatment of disputes/legal holds and expiry actions. Executors must reconcile ledger and payment invariants, resolve foreign keys and prevent retained evidence from remaining visible as an active member account. Keep the corresponding inventory rows unapproved until those details and implementation are complete.

### Fraud/security, notifications and analytics: product direction accepted

The user accepted the following recommended behavior for **B5 / B8 / B9**:

- Retain only necessary fraud/security evidence under restricted access and a defined expiry. Remove identity unless a documented investigation requires it.
- Delete queued notifications, delivery history, device tokens and delivery addresses. Keep required transaction evidence in the financial records rather than using notification history as a substitute ledger. Stop/reconcile in-flight delivery work so it cannot send or recreate registrations after deletion.
- Delete identifiable analytics/crash data held by connected providers. The mobile tracker currently has no provider; verify other services/processors before treating this step as not applicable. Do not claim processor deletion succeeded without confirmation/evidence or an explicitly documented expiry process.
- A specific legal hold may delay removal of affected evidence; it must not preserve an active account or unrelated data. Preserve the minimum identifiers necessary for a documented hold and restrict their use/access.

Exact security retention periods, lawful bases, retained fields, investigation/hold controls, processor inventory and expiry mechanisms remain pending. These accepted behaviors do not approve the inventory rows or open deletion processing.

### App scope and deletion proof: product direction accepted

The user clarified that public blockchain records are not part of the Akiba native app. Exclude them from the native app's deletion notice/flow; do not present blockchain retention as a native-app feature. Shared-backend wallet relationships or records originating in other services still require explicit scoping and cleanup when deleting a shared identity. This does not authorize discarding shared-backend inventory coverage or making false erasure claims for other services. Native copy changes remain to be implemented.

For **B11**, the user accepted a restricted minimal deletion record: request date, policy version, completion date and step outcomes, referenced by an opaque identifier. Remove email, phone, content and credentials after required confirmation delivery. Define an expiry period; an opaque reference is not anonymous if Akiba can still link it to a person. Resolve the current Auth foreign keys/soft-deletion and audit payloads against this requirement during implementation.

All behavior decisions have now been discussed. Retention terms and implementation remain incomplete; nothing in this log enables processing.

## Proposed retention worksheet — pending approval

### Working periods accepted — 2026-10-19

The user accepted these three proposed periods as working policy, subject to confirming necessity:

- Minimal moderation evidence: **90 days after deletion completion**.
- Necessary non-financial fraud/security evidence: **180 days after deletion completion**.
- Minimal proof of deletion: **24 calendar months after deletion completion**.

These are no longer unanswered product preferences. Remaining work is the necessity/lawful-basis assessment, exact retained columns, assigned access roles, schema/executor implementation and tested expiry. Do not treat this acceptance as approval of all outstanding `RetentionTerms`, financial periods, or production enablement. The table below remains a draft for the other terms; its three matching period proposals are now accepted on this basis.

### Payment scope correction — 2026-10-19

The user questioned whether the native app has payment records. Source verification found no money-payment integration in `packages/akiba-app/src` or its `/api/v1` routes: the voucher purchase flow spends Miles. `mpesa_stk_requests` / `mpesa_stk_results` exist in the shared database schema and older `/api/payments/mpesa/callback` and `/status` routes reference them, but this review has not established populated production rows or a native-app payment flow. Do not describe those tables as proof that native members make payments, and do not apply a tax-record retention period to Miles activity without a separate justified classification. The preceding question about a financial-versus-temporary payment retention split was **not accepted** by the user. Shared-service records still need verification before deleting a shared identity; classify that as a backend inventory check, not a native-app feature or a reason to retain every member's reward history.

### Native Miles and voucher evidence: working policy accepted — 2026-10-19

The user accepted the following proposed behavior and period:

- Immediately revoke unused vouchers and end access to Miles on confirmed deletion, without waiting for evidence-retention expiry. Reconcile in-flight transactions safely.
- Delete expired quotes and abandoned attempts once reconciled, rather than retaining them automatically with completed evidence.
- Retain minimal completed earning/redemption evidence for **180 days after deletion completion**, solely for reward disputes and reconciliation, under restricted access.
- Remove the member's identity/contact details; delete the retained evidence at expiry unless a specific documented hold applies.

This is an accepted working product policy, not a statutory accounting period. It supersedes any suggested five-year financial classification for native Miles/voucher history. It does not establish a period for actual shared-service payment records or game-prize evidence. Confirm any such records and their separate purpose before resolving those inventory rows. Completed referral evidence was subsequently resolved below. Exact field allowlists, evidence linkage needed for dispute lookup, assigned access roles, necessity assessment and tested cleanup remain implementation work; do not call linkable evidence anonymous or mark all retention terms approved on this basis alone.

### Completed referral rewards: working period accepted — 2026-10-19

The user accepted **180 days after deletion completion** for minimal completed referral-reward evidence, for reward reconciliation, matching the Miles/voucher evidence period. Remove the deleted member's identity and contact details, restrict access, and delete evidence at expiry unless a specific documented hold applies. This complements the already accepted Pass/referral behavior: invalidate the Pass, disable referral codes, cancel pending referral rewards and detach retained records from the deleted Pass/member without exposing that identity to the other party. Preserve completed entitlements belonging to the other member. Exact retained columns, safe retry/idempotency handling, permissions and necessity assessment remain implementation work. This acceptance does not cover game-prize or money-payment records.

The following is a starting proposal for review, not statutory advice or accepted production policy. Product-selected periods require a documented necessity assessment; finance must identify which records actually qualify as accounting/tax evidence. Do not copy these into `RetentionTerms` as approved values yet.

| Record class | Proposed period and start event | Minimal retained information | Proposed access | At expiry |
|---|---|---|---|---|
| Profile, Pass secrets, images, drafts without dependencies, preferences and push registrations | No post-deletion retention; remove during processing | None | Deletion worker while processing | Verify removal, including queued work |
| Moderation evidence and required parent stubs | 90 days after deletion completion, subject to documented necessity and audit-schema resolution | Opaque evidence references, action/reason codes and event times; no images, text content or ordinary member link | Moderation lead; privacy owner | Delete evidence/stubs in dependency order through an approved audit-expiry mechanism |
| Non-financial fraud/security evidence | 180 days after deletion completion, subject to documented necessity | Event type, relevant timestamps, bounded risk outcome and minimum investigation evidence | Designated security lead; privacy owner | Delete; a specific documented hold pauses only affected records |
| Financial records, including completed referrals/prizes when accounting evidence | Finance-confirmed legal schedule; candidate baseline is five years from the end of the relevant reporting period, not five years from deletion | Finance-approved transaction IDs, amounts, dates, merchant/settlement references and strictly required identifiers | Finance; authorized audit/legal roles | Delete or irreversibly aggregate after applicable obligations/holds expire |
| Non-financial completed reward/referral evidence | Do not automatically apply the tax period; finance/product must classify purpose and propose a justified period | Only fields necessary for the classified purpose | Purpose-specific restricted roles | Delete at approved expiry |
| Notification history and delivery addresses | Remove during deletion processing | None; financial evidence belongs in its own records | Deletion worker while processing | Verify queues cannot recreate/send |
| Identifiable analytics/crash processor data | Request deletion during processing; actual completion/backup expiry depends on verified processor policy | Minimal deletion acknowledgement only | Privacy owner; deletion worker | Confirm removal/expiry; no unsupported completion claim |
| Proof of deletion | 24 months after completion, subject to documented necessity | Opaque request ID, policy version, request/completion dates, bounded step outcomes; no contact details or credentials | Privacy owner; authorized compliance/audit role | Delete proof and any residual identity linkage |

Proposed operational controls: daily expiry job, monthly failure/hold review, annual schedule review; holds must have a reason, scope, owner and review date. These controls are also pending acceptance and implementation. Database, Storage, backups, logs and external processors need separate verified coverage; a primary-row delete is not proof of immediate backup erasure.

Outstanding facts: actual Supabase region and backup retention, deployed processor inventory, named role assignments, financial reporting calendar and legal holds, exact column allowlists and foreign-key changes. The policy model now supports day/month/year durations anchored to deletion completion, a named record event, or a reporting-period end with an explicit calendar reference, time zone and source field. Reporting-calendar expiry execution remains unimplemented and outside the native-only release; no financial schedule is approved by this model change. The native evidence migration independently implements the accepted completion-based clocks.

Sources checked on 2026-10-19:

- [ODPC General Regulations 2021](https://www.odpc.go.ke/wp-content/uploads/2024/03/THE-DATA-PROTECTION-GENERAL-REGULATIONS-2021-1.pdf): retention schedules and necessity review.
- [KRA recordkeeping FAQ](https://www.kra.go.ke/component/kra_faq/faq/449) and [Tax Procedures Act reference](https://www.kra.go.ke/images/publications/TaxProceduresAct29of2015.pdf): five-year tax-record baseline; applicability, current amendments and proceedings exceptions require finance/legal confirmation. This is not a justification to retain every app record for five years.

---

## What this document is for

`DELETION_INVENTORY` now has 23 rows. **18 formal retention/scope contracts remain incomplete** — their `retention`
is `null` — and `assertInventoryApproved()` throws while any of them is, so
no member data can be deleted in any environment. The acceptance path is
gated on the same condition, so requests are *refused* rather than accepted
and stranded.

The accepted working periods are recorded above and in code. The additional canonical-identity row records shared Platform coverage; this is not a request to repeat the accepted product decisions. Exact legal/operational terms and shared-service handlers remain outstanding. See [implementation status and rollout](akiba-account-deletion-rollout.md).

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
  schedule: {                      // illustrative only; no period approved here
    startsAt: "deletion_completed",
    duration: { unit: "days", count: 180 },
  },
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

## Scope steering — native-only release (2026-10-19)

After inspection of Akiba-Platform, the user explicitly chose: **limit this release to native-app data and review shared-account effects first**. This supersedes any implementation assumption that native deletion may remove the shared Auth identity, canonical identity links or Platform Miles ledger. Those operations are excluded from activation; the shared ledger mutation exception and Auth hard-delete change were removed. The earlier working retention periods remain recorded, but no whole-account pipeline may be enabled until native lifecycle isolation/shared effects are reviewed. The database preflight reports `shared_account_scope_review` and the executable registry deliberately omits shared Auth/canonical cleanup. This adds a scope review item, not another request to choose a retention period.
