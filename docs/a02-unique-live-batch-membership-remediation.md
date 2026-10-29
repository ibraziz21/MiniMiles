# A02: unique live reimbursement batch membership

Status on 29 October 2026: **fixed and verified on branch `urjamfbtlzycetvuvwpg`; production rollout pending**. A03's reversal/stale-batch validation remains open and is not solved by this change.

## Database invariant

[Platform migration 161](/Users/ibraziz21/Desktop/Work/Akiba-Platform/supabase/migrations/161_unique_live_voucher_batch_membership.sql) adds `voucher_funding_live_batch_memberships`, keyed uniquely by `voucher_redemption_id` and associated with `batch_id`.

“Live” means non-cancelled, including paid. A submitted or paid batch retains its reservation. A cancelled batch releases its reservation while preserving immutable batch-item history.

- The create RPC locks redemption rows in UUID order before reading unbatched availability, and iterates selected items in the same stable order. Opposite caller array orders do not create an inverted lock sequence.
- Every batch-item insert passes through the reservation trigger, including direct server inserts that bypass the create RPC. The primary key enforces uniqueness across transactions and older Repeatable Read snapshots; ordinary SELECT visibility is not the authority.
- A unique conflict raises the existing `PAYABLE_ALREADY_IN_LIVE_BATCH` error. The failed item and reservation mutation roll back together. An RPC that can no longer batch its requested set rolls back its new batch, items and audit row rather than returning a partial batch.
- The draft-only insert trigger locks the parent batch before validating its state, serializing item insertion with submission/cancellation.
- Cancelling releases reservations in the same transaction. Cancelled batches cannot reactivate through a direct state write. Paid batches cannot transition away from paid through a direct state write and release their reservation.
- The reservation table has RLS enabled, no PUBLIC/anon/authenticated access, and service-role SELECT only. Service clients cannot directly insert, update or delete reservations. Fixed-search-path, SECURITY DEFINER trigger functions own reservation mutations.

The reservation row is bookkeeping for immutable financial history. Existing payable, redemption, purchase and Miles rows are not rewritten. RPC signatures, merchant checkout and statement contracts are unchanged.

## Upgrade safety

The migration takes write-conflicting table locks on reimbursement batches and items while checking/backfilling the invariant and installing guards. Apply it as one transaction.

It backfills all existing non-cancelled batch items. Existing duplicate live memberships raise `EXISTING_DUPLICATE_LIVE_BATCH_MEMBERSHIP` before installation. It does not silently delete items, choose a winning batch, or cancel a paid batch. Missing legacy redemption references also fail the backfill's foreign key rather than create an ungrounded reservation. Any preflight failure requires financial reconciliation before retrying deployment.

## Verification

### Committed concurrency tests in a disposable database

The suite uses the real migration replay and Miles award chain to generate actual payables. Two clients begin independent transactions. The second's PostgreSQL lock wait is observed through `pg_stat_activity`, rather than assumed after a fixed delay.

For competing successful calls, the test attempts to commit each successful transaction; a failed SQL transaction is explicitly rolled back. Assertions prove one committed live batch item, one reservation, and no extra empty batch from the losing RPC.

Covered cases:

1. RPC competition under Read Committed: exactly one live batch commits.
2. RPC competition under Repeatable Read: stale snapshot cannot bypass reservation uniqueness.
3. Direct item inserts into separate batches: the second cannot commit a duplicate item.
4. First contender rolls back: the waiting transaction succeeds and commits its reservation.
5. Two overlapping redemptions supplied in opposite orders: no deadlock and only one winning batch/set.
6. Cancellation releases membership, re-batching succeeds, and cancelled history cannot reactivate.
7. Paid reservation survives and cannot be released via a direct cancellation write; re-batching is refused.
8. Reservation-table RLS/grants prevent client access and direct server mutation.
9. The actual forward migration backfills populated pre-161 history, including retained paid items and excluded cancelled items.
10. The actual forward migration refuses a simulated pre-161 duplicate-live-batch state. Both schema/data upgrade simulations run inside rolled-back transactions.

Latest passing funded-suite runs total **97 tests**: 22 accounting/security, 38 percent/weekend and 37 multi-merchant. The last full three-suite run passed 95; two additional upgrade tests then passed in the 22-test accounting suite. Hub typecheck and diff whitespace checks passed. No unrelated failing merchant test was changed.

### Verification branch

Applied migration receipt:

- Version: `20261029103806`
- Name: `platform_161_unique_live_voucher_batch_membership`
- SHA256: `c06359584e3ca84d91725edb9bc839746801ddc2a22f2a944985f6b3ebb2c97f`

Two branch connections ran as `service_role`. The first created a draft batch inside an open transaction. The second was observed waiting for its lock. After the first rolled back, the second successfully reserved the payable. A direct insert of that redemption into another batch was rejected with `PAYABLE_ALREADY_IN_LIVE_BATCH`. The second transaction was then rolled back too.

The branch's batch count returned to its initial value and the synthetic merchant's payable remains KES100. No test payment or test batch was committed on the shared branch. The new migration/schema guards are committed there.

Private local receipts are `.verification/a02-migration-result.json` and `.verification/a02-branch-verification.json`. The repeatable two-connection regression tests are in [funded-secondary-merchant-accounting.test.ts](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/src/__tests__/integration/funded-secondary-merchant-accounting.test.ts).

## Production rollout and remaining scope

Production is unchanged. Apply migration 161 transactionally through the approved migration procedure, with its existing funding/batch prerequisites present. Preserve the actual migration version/order; do not replay historical migrations. Review any duplicate-preflight failure as a financial incident rather than bypassing the check. A01 migration 160 remains a separate pending production security fix.

After deployment, verify the reservation-to-non-cancelled-item correspondence, private table/function grants, and normal finance batch creation/cancellation. Keep the committed competition tests as release regressions.

This fix prevents one redemption appearing in two non-cancelled batches. It does **not** reconcile a batch's amount after a partial reversal or revalidate entitlement at submission/payment; that is A03. Other audit findings remain unchanged. Production migration-order verification remains false.

## Subsequent A03 work

The stale-amount gap recorded above was subsequently addressed on the verification branch by migration 162. See [A03 settlement revalidation](a03-settlement-revalidation-remediation.md). Production rollout remains pending.
