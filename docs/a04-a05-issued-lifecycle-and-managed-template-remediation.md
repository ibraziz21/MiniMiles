# A04/A05: issued validity and managed template ownership

Status on 29 October 2026: **fixed and verified on branch `urjamfbtlzycetvuvwpg`; production rollout pending**.

## Issued validity (A04)

[Platform migration 163](/Users/ibraziz21/Desktop/Work/Akiba-Platform/supabase/migrations/163_funded_issued_voucher_lifecycle.sql) separates acquisition availability from redemption validity in both `inspect_kes_voucher_presentation` and `redeem_kes_voucher_and_award_atomic`.

For an issued `akiba_reimbursement` voucher, the template's `active`, `lifecycle_state`, `start_at` and `end_at` no longer decide redemption. Allocation pause/end and claim-window closure still refuse new claims. An existing funded entitlement remains usable until its own expiry, subject to its issued status, presentation token validity, snapshot merchant set, redemption schedule and the existing checkout/accounting checks. The migration carries forward the complete 157 definitions, including legacy TEXT product-ID compatibility and atomic Miles/payable handling.

Ordinary merchant-discount vouchers retain their existing template lifecycle/window checks. This change does not widen their validity.

Explicit revocation remains `revoke_akiba_funded_voucher_atomic`, with a reason and audit trail. It changes the issued status to `revoked` and releases its reservation once. Both inspect and redeem still require `issued`, so even a previously issued, unexpired QR cannot redeem after revocation. Template deactivation is not a revocation control. There is no separate implemented funding-suspension control; this repair does not invent one or claim that a program/allocation pause revokes issued vouchers. Existing merchant subscription, snapshot schedule and other till checks remain unchanged.

## Managed templates (A05)

[Platform migration 164](/Users/ibraziz21/Desktop/Work/Akiba-Platform/supabase/migrations/164_managed_voucher_template_write_boundary.sql) protects a template when **any** of these markers is present: `managed_by='akiba'`, a non-null `funding_allocation_id`, or `funding_mode='akiba_reimbursement'`.

- Merchant PATCH and deactivation routes check ownership before validation, qualification RPCs, writes or success audits. Managed requests return HTTP403 `MANAGED_TEMPLATE_READ_ONLY`; failed authorization lookups stop the operation.
- The merchant locations PUT route refuses managed-template changes before deleting or inserting location rows.
- `publish_kes_voucher_atomic` checks managed ownership under its existing row lock, before the already-published fast path and any repricing or mutation. Its merchant route maps the denial to the same clear HTTP403.
- Invoker triggers protect direct template INSERT/UPDATE/DELETE and location INSERT/UPDATE/DELETE. Old and new classifications are checked, so clearing the managed markers cannot evade the guard. Location writes lock their parent template while classifying it.
- Direct `service_role` writes cannot alter managed templates. Trusted table-owner execution is retained for the existing SECURITY DEFINER funding-authoring/lifecycle RPCs. The trigger does not trust request-settable session variables. The merchant publish RPC needs its explicit guard precisely because it also executes in owner context.

This is an application-role boundary, not protection against a database owner or superuser. Service credentials and owner-run RPC authorization remain trusted server responsibilities. No new anonymous or authenticated RPC grant is added.

## Verification

- **119 funded integration tests passed:** 44 accounting/security/lifecycle tests, 38 percent/weekend tests and 37 multi-merchant tests. The 14 new database cases cover pause/end/window closure, new-claim refusal, real secondary-merchant redemption and payable/Miles creation, explicit revocation with no redemption-side financial writes, voucher/token expiry, ordinary merchant validity, direct managed-template mutations, publish-RPC refusal, location writes and permitted ordinary merchant edits.
- **19 targeted merchant-route tests passed**, including 13 new managed-template cases. They prove refusal before mutation/RPC/audit side effects, independent managed markers, deactivation, both location modes, authorization lookup failure and publish-error mapping. Existing six PATCH cases still pass.
- Hub and merchant-dashboard TypeScript checks passed.
- **Real branch service-role transactions:** after pause, end or closed acquisition window, the real presentation RPC issued a token, inspect accepted it and real checkout redeemed at secondary B for KES100 reimbursement and 9 Miles. Explicit revocation refused inspect and checkout with no further financial records. Direct benefit/deactivation/reclassification/deletion writes and the merchant publish RPC were denied. Every probe transaction was rolled back; the original issued voucher, snapshot, expiry and financial counts were unchanged.
- A real service-key REST PATCH against the managed template returned HTTP403 `42501` / `MANAGED_TEMPLATE_READ_ONLY`.

Private receipts are ignored under `.verification/a04-a05-migration-result.json`, `.verification/a04-a05-branch-verification.json` and `.verification/a05-rest-verification.json`. No credentials are included in this document.

Branch migration records:

| File | Applied version | SHA-256 |
| --- | --- | --- |
| 163 | 20261029110746 | `3a150d88e16cae9efc2e8a02e26f6cea0fe0d39cd645de0cbb1eb2e153e078c6` |
| 164 | 20261029110747 | `f40a83072594b9ebe26780ae0feca809b7a46902ad30444d1bd8cf71a412c054` |

## Production rollout

Production was not modified. Reconcile live function definitions and applied migration history, then apply 163 and 164 transactionally through the normal production process and deploy the merchant route changes together. Apply the earlier pending A01–A03 repairs separately as part of the same release plan.

Before 164, verify that trusted funding RPC owners match the template table owner and that application roles cannot assume that owner role. A mismatch must be resolved deliberately; do not weaken the trigger to allow all service-role writes. Confirm the deployed merchant publish RPC includes the managed-template guard rather than a later stale replacement. Test one normal merchant edit and one authorized funded authoring/lifecycle action after deployment.

Neither migration retroactively revokes vouchers or edits their snapshot/expiry/benefit. Paused/ended funded allocations may already have outstanding issued vouchers: the corrected behavior makes those usable again until their own expiry. If a specific entitlement must be withdrawn, use explicit audited revocation rather than relying on the prior pause bug. Remaining audit findings and production migration-order verification are still open.
