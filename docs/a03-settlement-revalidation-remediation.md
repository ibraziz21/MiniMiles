# A03: revalidate settlement amounts

Status on 29 October 2026: **fixed and verified on branch `urjamfbtlzycetvuvwpg`; production rollout pending**.

## Behavior

[Platform migration 162](/Users/ibraziz21/Desktop/Work/Akiba-Platform/supabase/migrations/162_revalidate_voucher_settlement_amounts.sql) validates each batch item against its current net payable at submission and immediately before recording paid status. It also verifies the batch sum, merchant, currency, positive entitlement and live membership. A stale batch raises `BATCH_PAYABLES_CHANGED`; its state, evidence, payment timestamp and success audit history remain unchanged.

Recovery is explicit cancellation and rebuilding from current payables. Original items, payments, reversals and audit history are preserved. The migration does not silently change an approved total or automatically cancel a submitted payment batch.

The database trigger applies to direct batch inserts/state writes as well as `transition_voucher_reimbursement_batch_atomic`. A net-neutral set of adjustments is still rejected if individual batch item amounts no longer match. A fully reversed batch cannot submit or pay. Previously paid amounts/merchant/currency cannot be edited.

## Concurrency and snapshot safety

- Every payable append, including direct adjustments, locks its redemption row. This is the same stable row locked by the existing reversal RPC and A02 batch creation.
- Settlement owns the batch row, then locks its redemptions in stable UUID order, then locks its live-membership rows. No payable append can change the checked entitlements between validation and transaction commit.
- A private `payable_revision` column on the A02 membership table is advanced by payable changes and by successful approval/payment. Old Repeatable Read snapshots encounter a serialization failure instead of approving stale net amounts or missing a newly recorded payment.
- Item insertion touches the parent batch version, so a settlement snapshot older than an appended item cannot silently miss it.
- If a reversal commits first, the waiting payment is refused or must retry its snapshot. If payment commits first, the existing reversal RPC preserves the paid amount and records `reversal_after_payment` reconciliation; an older-snapshot reversal must retry first.
- The migration drains older batch-item/payable writers with table locks before altering the membership table and installing the new guards. Apply it transactionally.

Existing private-view and membership-table access restrictions remain in place. New trigger functions use fixed search paths and are not executable by public/anon/authenticated clients. No new public view or client-writeable table was introduced.

## Operator errors

The admin reimbursement route and Platform finance transition route return HTTP409 for stale amounts, explaining cancellation/rebuilding. Serialization/deadlock conflicts return HTTP409 `SETTLEMENT_RETRY_REQUIRED` with reload/retry instructions. Failed admin actions write no successful action audit.

**External-transfer limit:** these endpoints record payment status; they do not atomically execute a bank or M-Pesa transfer. A database refusal cannot undo a transfer sent outside Akiba. The error message explicitly tells the operator to reconcile any transfer already sent before creating another payment. An automated payout integration would need its own durable payment-intent/idempotency and provider-reconciliation workflow; this change does not claim to implement that.

## Verification

- **105 funded integration tests passed:** 30 accounting/security/settlement, 38 percent/weekend and 37 multi-merchant. The final deployment-lock change was also replayed successfully through all 30 accounting tests.
- Eight new settlement cases cover stale submission, stale payment, unchanged refusal state/evidence/audit, cancellation/rebuild at KES40, direct state writes, batch-total tampering, offsetting per-item adjustments, full reversal, and both race orders under Read Committed and Repeatable Read. The two stale-action cases each exercise the valid rebuilt submit/pay path.
- **Five operator-error tests passed:** actual admin route responses for stale submit/pay and serialization/deadlock errors, plus readable error translation. Rejected actions write no success audit.
- Hub, admin and Platform API TypeScript checks passed; diff whitespace checks passed.
- The existing TEXT/UUID schema-compatibility test now closes its pool after restoring the column type, so subsequent tests do not reuse PL/pgSQL sessions compiled against the temporary TEXT row shape. This is disposable-fixture isolation, not a production schema change.
- Older raw batch fixtures now include the correct item total before advancing state, rather than relying on the former absence of sum validation.

On the shared branch, tests ran as `service_role` inside rolled-back transactions:

| Attempt | Original batch | Remaining payable | Result | Recovery |
| --- | ---: | ---: | --- | --- |
| Submit after partial reversal | KES100 | KES40 | Rejected, batch unchanged | Cancel/rebuild at KES40, submit succeeds |
| Mark paid after partial reversal | KES100 | KES40 | Rejected, batch unchanged | Cancel/rebuild at KES40, submit succeeds |

All probe changes were rolled back. The batch count returned to its initial value and the real synthetic B payable remains KES100. No shared-branch payment or test batch was committed.

Migration receipt:

- Version: `20261029105612`
- Name: `platform_162_revalidate_voucher_settlement_amounts`
- SHA256: `87c4d4f08ee6eab18f7bba03d70ffdd395f5cc026a26a5f3290abae61cd5ffb8`

Private receipts are ignored `.verification/a03-migration-result.json` and `.verification/a03-branch-verification.json`. Committed concurrency tests run only in the disposable local test database, not main or the shared branch. The Platform finance route change was typechecked; its authenticated deployed HTTP flow was not exercised here. The actual admin route error flow is covered by the five tests above.

## Rollout

Production was not changed. Apply 162 transactionally after 161, preserve migration inventory, and deploy the admin/API conflict messages. The database rejects stale actions even if an older API returns a less helpful error. Apply during a suitable short write-maintenance window: the migration takes locks on reimbursement batches/items/payables and the private membership table.

Verify a valid settlement path and the stale-action denials on synthetic data before release. Cancel/rebuild stale unpaid batches; reconcile externally transferred money before creating another payment. Existing stale drafts/submitted batches are not rewritten by migration and will be rejected when advanced. Historical paid records are not retroactively altered or reconciled automatically.

A01 and A02 production rollout remains separate and pending. Other audit findings and the historical migration-order verification gap remain open.
