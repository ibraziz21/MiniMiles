# Staging verification — multi-merchant funded vouchers

**Status:** Procedure, not a result. Nothing here has been executed.
**Scope:** Akiba-Platform 154–156 + MiniMiles 113, on a staging database.
**Blocks:** Publication of any multi-merchant allocation.

Local suites give bounded evidence only: the replay harness cannot apply 56
MiniMiles migrations and hand-writes five identity tables
(see the verification gap in
[the launch spec](multi-merchant-funded-vouchers-launch-spec.md)). A fresh
database built from that same partial manifest would re-test the same subset,
so it closes nothing. **This must run against a staging database carrying the
real schema, including the excluded MiniMiles changes.**

Run everything as the service role. **Do not run section 3 against
production** — it issues and spends real vouchers.

---

## 1. Reconcile what is actually installed

Read, do not assume. Record each result alongside this checklist.

### 1.1 Applied migrations

```sql
-- Supabase tracks applied migrations here. If this table is absent, use
-- whatever the deploy pipeline records instead and note which you used.
SELECT version, name
  FROM supabase_migrations.schema_migrations
 ORDER BY version;
```

Confirm present: Platform `151`, `152`, `154`, `155`, `156`; MiniMiles `110`,
`112`, `113`. If any is missing, stop — the rest of this runbook describes
behaviour that does not exist yet.

Apply order is **Platform 154 → MiniMiles 113**: 113 calls
`voucher_allocation_eligible_merchants()`, which 154 creates.

### 1.2 The constraint that silently breaks funded claims

```sql
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'chk_iv_acquisition_source';
```

**Must contain** `akiba_funded_claim`, `akiba_funded_grant`,
`akiba_funded_auto_award`. MiniMiles 068 defines this constraint without them;
if it was applied after Platform 129/133 in this environment, every funded
claim fails here. This is the single highest-value pre-flight check.

### 1.3 Critical function definitions

Names prove nothing — a failed replacement leaves an older body under the same
name.

```sql
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%voucher_redeemable_by_partner%' AS has_merchant_gate,
       pg_get_functiondef(p.oid) LIKE '%eligible_merchant_ids%'        AS reads_snapshot_set,
       pg_get_functiondef(p.oid) LIKE '%voucher_allocation_eligible_merchants%' AS uses_set_fn,
       pg_get_functiondef(p.oid) LIKE '%miles_ledger%'                 AS writes_miles
  FROM pg_proc p
 WHERE p.proname IN (
   'redeem_kes_voucher_and_award_atomic',
   'inspect_kes_voucher_presentation',
   'voucher_redeemable_by_partner',
   'voucher_allocation_eligible_merchants',
   'claim_akiba_funded_voucher_atomic',
   'voucher_allocation_merchant_readiness',
   'award_purchase_reward_v2',
   'create_voucher_funding_allocation_with_merchants_atomic',
   'update_voucher_funding_allocation_draft_with_merchants_atomic',
   'set_voucher_allocation_merchants_atomic'
 )
 ORDER BY 1;
```

Expected: `has_merchant_gate` true for both redeem and inspect;
`reads_snapshot_set` true for `voucher_redeemable_by_partner`; `uses_set_fn`
true for the claim RPC; `writes_miles` true for `award_purchase_reward_v2`. All
ten functions present.

### 1.4 Triggers on the money path

```sql
SELECT c.relname AS table_name, t.tgname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND c.relname IN ('issued_vouchers','voucher_redemptions',
                     'voucher_claims','voucher_eligibility_rule_sets')
 ORDER BY 1, 2;
```

Expected at least: `trg_snapshot_funded_allocation_merchants` and
`trg_snapshot_funded_redemption_schedule` on `issued_vouchers`;
`trg_enforce_funded_redemption_schedule` on `voucher_redemptions`;
`trg_enforce_funded_voucher_claim_eligibility_audit` on `voucher_claims`;
`trg_validate_funded_voucher_rule_set_row` on
`voucher_eligibility_rule_sets`.

Both `issued_vouchers` snapshot triggers must be present. They merge into
`rules_snapshot` with `||` and each touches only its own key, so order does not
matter — but one missing means the corresponding field never reaches the
voucher.

### 1.5 The identity tables the local harness had to fake

```sql
SELECT table_name,
       string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('hub_user_canonicals','hub_user_profiles',
                      'hub_user_passes','leaderboard_profiles','users')
 GROUP BY table_name
 ORDER BY table_name;
```

Compare against the hand-written shapes in
`packages/hub-page/src/__tests__/integration/helpers/platformReplay.ts`. **Any
difference is a local test that was passing against the wrong shape** — record
it and correct the harness.

Note in particular which column carries the member's country
(`hub_user_profiles.country` vs `country_code`): the claim RPC reads
`country_code`, and a staging row populated only in `country` yields
`COUNTRY_PROFILE_REQUIRED`.

### 1.6 The excluded MiniMiles changes

Confirm staging has what the harness could not replay. Object presence is a
proxy for the migration having run:

```sql
SELECT 'merchant_transactions' AS object,
       to_regclass('public.merchant_transactions') IS NOT NULL AS present
UNION ALL SELECT 'merchant_products',       to_regclass('public.merchant_products') IS NOT NULL
UNION ALL SELECT 'voucher_events',          to_regclass('public.voucher_events') IS NOT NULL
UNION ALL SELECT 'voucher_purchase_quotes', to_regclass('public.voucher_purchase_quotes') IS NOT NULL
UNION ALL SELECT 'reconciliation_incidents',to_regclass('public.reconciliation_incidents') IS NOT NULL
UNION ALL SELECT 'fulfillment_jobs',        to_regclass('public.fulfillment_jobs') IS NOT NULL;
```

All should be present. If any is absent, staging is not
production-equivalent and the gap persists — say so rather than proceeding.

---

## 2. Authoring, review and publication

Through the Admin Dashboard, not SQL — the point is to exercise the operator
path.

1. Create a fund (KES) and take it to **active**.
2. Create an allocation: primary merchant **A**, "Also redeemable at" **B**,
   10% off, cap KES 200, minimum spend above the cap, quantity small (5).
3. On the allocation detail page, confirm the **Participating merchants** card
   lists A and B with Ready/Not ready badges and a count.
4. **Negative:** suspend B's subscription, reload, confirm B shows *Not ready*
   with a subscription reason and the "Cannot publish yet" banner appears.
   Attempt publish — expect a 409 naming **B** and its reason, and confirm with
   §2.6 that nothing changed.
5. Restore B's subscription, then `submit` → `approve` (needs
   `finance_admin`, a different operator) → `publish`.
6. Confirm a refused publish left no trace:

```sql
SELECT a.state, a.version, t.active, t.lifecycle_state, t.published_at
  FROM voucher_funding_allocations a
  JOIN spend_voucher_templates t ON t.id = a.voucher_template_id
 WHERE a.id = :allocation_id;

SELECT count(*) FROM audit_logs
 WHERE entity_id = :allocation_id AND action = 'allocation.publish';
```

7. **Draft membership:** on a second draft allocation, remove B, save, reload,
   confirm B is gone; re-add B, save, reload, confirm it persisted. Then have a
   second operator hold a stale version and save — expect a version-conflict
   rejection with the first operator's selection intact.

---

## 3. Functional checks

**Staging only.** Record the allocation and voucher ids used.

### 3.1 Secondary-merchant checkout

Claim the offer as a test member on the web, then redeem **at B's real till**
(scan → bill entry → confirm) with a bill of KES 1,000.

Expected at the till: discount KES 100, net KES 900.

```sql
-- Everything must name B. Nothing may name A.
SELECT 'redemption' AS record, merchant_id::text, discount_amount_kes::text, net_amount_kes::text
  FROM voucher_redemptions WHERE issued_voucher_id = :voucher_id
UNION ALL
SELECT 'purchase', pe.merchant_id::text, pe.amount::text, pe.currency
  FROM purchase_events pe
  JOIN voucher_redemptions vr ON vr.purchase_event_id = pe.id
 WHERE vr.issued_voucher_id = :voucher_id
UNION ALL
SELECT 'payable', merchant_id::text, payable_amount_minor::text, entry_type
  FROM voucher_funding_payables WHERE issued_voucher_id = :voucher_id
UNION ALL
SELECT 'miles', ml.partner_id::text, ml.amount::text, ml.direction
  FROM miles_ledger ml
 WHERE ml.source_id IN (SELECT purchase_event_id FROM voucher_redemptions
                         WHERE issued_voucher_id = :voucher_id);

-- Reservation released in full, realised amount only.
SELECT entry_type, amount_minor
  FROM voucher_funding_ledger_entries
 WHERE issued_voucher_id = :voucher_id ORDER BY entry_type;
```

Expected: `reservation_created` +20000, `reservation_released` −20000,
`redemption_realized` +10000; payable 10000; every `merchant_id`/`partner_id`
is B's.

### 3.2 Replay

Repeat the identical checkout at B — same bill, same checkout attempt id. The
till should show the committed result, not a second redemption.

Re-run the §3.1 queries: **exactly one** row of each record type, and one
`redemption_realized`.

### 3.3 Concurrent redemption

Present the same voucher at A and B as close to simultaneously as two tills
allow. Exactly one should succeed.

Re-run §3.1: one redemption, one purchase, one payable, one Miles row, one
`reservation_released`, one `redemption_realized` — all naming the same
merchant, and nothing naming the other.

### 3.4 Schedule rollback

Create an allocation with a redemption schedule excluding today, claim it, then
attempt redemption.

Expected: refusal (`REDEMPTION_DAY_NOT_ALLOWED`), and:

```sql
SELECT (SELECT count(*) FROM voucher_redemptions WHERE issued_voucher_id = :voucher_id) AS redemptions,
       (SELECT count(*) FROM voucher_funding_payables WHERE issued_voucher_id = :voucher_id) AS payables,
       (SELECT count(*) FROM voucher_funding_ledger_entries
         WHERE issued_voucher_id = :voucher_id AND entry_type <> 'reservation_created') AS post_claim_ledger,
       (SELECT status FROM issued_vouchers WHERE id = :voucher_id) AS voucher_status;
```

Expected: 0, 0, 0, and `issued`.

### 3.5 Outside merchant

Scan the voucher at a merchant **not** in the set. Expected: refused at the
preview, with no new rows from the §3.4 query.

### 3.6 Old-client protection

With `MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED` unset, against a build carrying
the pre-`merchants` contract:

- `GET /api/v1/vouchers` — the multi-merchant offer is absent.
- `GET /api/v1/me/vouchers` — the **still-usable** multi-merchant voucher is
  absent, but redeemed and expired ones are **present** (history is not hidden).
- `GET /api/v1/me/vouchers/{id}` — 409 `VOUCHER_NOT_SUPPORTED`, message
  containing a working `/vouchers/{id}` URL. Open that URL and confirm the
  voucher is reachable on the web.
- `POST /api/v1/vouchers/funded/{id}/claim` — 409 `OFFER_NOT_SUPPORTED`, and no
  voucher issued.

---

## 4. Browser checks

Not yet done, and not automatable here. On staging, as a signed-in member:

| Surface | Confirm |
|---|---|
| `/vouchers` offer card | "Use once at any of N merchants"; the disclosure opens and lists every merchant, each linking to its page; keyboard-reachable |
| Merchant page card (secondary) | The offer appears on **B's** page, says it is also usable elsewhere, and does not suggest a separate voucher per stall |
| Owned voucher `/vouchers/{id}` | Participant list from the snapshot, above the QR |
| Incomplete participants | Archive one participant, reload: the count stays at N and an amber notice explains some details are unavailable; the entitlement is not reduced |
| Single-merchant offer | Unchanged — no count, no disclosure |
| Mobile width | Participant list and notice legible at 375px |

---

## 5. Recording the result

For each section: the queries run, their output, and pass/fail. Note the
staging deploy versions and the allocation/voucher ids used.

Then, if §1 reconciliation matched expectations, set
`MIGRATION_ORDER_VERIFIED_AGAINST_PRODUCTION = true` in
`platformReplay.ts` **only** if the applied-migration list also confirms the
manifest's order. Reconciling object state is not the same as confirming order;
if you verified only object state, say so and leave the flag false.

Publication stays blocked until §1–§4 pass.
