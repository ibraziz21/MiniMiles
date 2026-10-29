# A01: private voucher financial views

Status on 29 October 2026: **fixed and verified on branch `urjamfbtlzycetvuvwpg`; production rollout pending**. Production was not changed by this remediation. The original audit's finding remains relevant to main until this migration is deployed there and verified.

## Change

[Platform migration 160](/Users/ibraziz21/Desktop/Work/Akiba-Platform/supabase/migrations/160_private_voucher_financial_views.sql) hardens nine existing views:

- `v_voucher_funding_allocation_budget`
- `v_voucher_funding_allocation_availability`
- `v_voucher_funding_program_budget`
- `v_voucher_payable_net_amounts`
- `v_unbatched_voucher_payables`
- `v_partner_voucher_payable_balances`
- `v_partner_settlement_batches`
- `v_open_voucher_reconciliation_incidents`
- `v_merchant_voucher_reimbursement_statement`

For each view, the migration revokes all relation privileges from `PUBLIC`, `anon` and `authenticated`, grants SELECT to `service_role`, and enables PostgreSQL 15 `security_invoker`. Views are altered in place: no dropped objects, rewritten financial rows, changed statement definitions or removed dependencies. Existing server-only RPC execution permissions remain unchanged.

Revoking `PUBLIC` avoids inherited access through that role. Revoking all relation privileges closes more than SELECT. Invoker semantics protect the dependency chain as defense in depth, should an outer view accidentally regain a grant later; direct client access still remains forbidden.

The merchant API continues to derive its merchant ID from the session. A signed-in merchant receives data through that scoped API, not by supplying a merchant ID to a public database view or server-only RPC. The finance API, admin dashboard and claim eligibility route use server-side service-key clients for the reviewed view reads.

## Dependency and default-grant review

A recursive `pg_depend`/`pg_rewrite` inspection found the nine private views above, including balances, budgets and reconciliation incidents beyond the four initially tested. Their underlying financial tables have RLS enabled. Before migration 160, all nine views permitted anonymous reads and none had invoker security.

Both `postgres` and `supabase_admin` have broad public-schema default relation grants to anon/authenticated/service_role. **Those shared defaults were audited, not globally changed:** unrelated public resources depend on them. This is an explicit residual migration-authoring risk. Every future private view must set its ACL and invoker security in the same deployment transaction; recreating an old view without the final hardening migration can reopen access.

The disposable accounting harness now reproduces Supabase's broad relation defaults instead of silently relying on vanilla PostgreSQL defaults. A regression discovers the financial dependency closure and checks its access restrictions; adding another dependent public view requires reviewing/updating the expected private-view inventory. This makes an accidentally granted future financial view fail the integration check.

No generic grant changes were made to unrelated views or tables, and no global event trigger was installed.

## Verification

Migration applied on the verification branch in one transaction:

- Version: `20261029102233`
- Name: `platform_160_private_voucher_financial_views`
- SHA256: `1adc7252c0c9ddfb03d5376ef58495b16200c82c63bdac9e3559af0586b3a4f5`

Real Supabase REST checks: **40 passed**.

| Actor/path | Checks | Result |
| --- | ---: | --- |
| Anonymous: all nine private views + statement RPC | 10 | Access denied |
| Synthetic Merchant A: all nine private views + B's statement RPC | 10 | Access denied |
| Synthetic Merchant B: all nine private views + statement RPC | 10 | Access denied directly; own data is available through the scoped merchant API |
| Service role: all nine views + B's statement RPC | 10 | Allowed; B retains the expected KES100 outstanding payable |

Direct view denials require HTTP 401/403 with PostgreSQL permission-denied code `42501`; successful service reads prove the endpoints still exist. RPC denials allow the permission-hidden PostgREST function result as well. Checks never log passwords, API keys, JWTs, or returned financial records. The expected positive synthetic payable prevents an empty database from masking a broken statement.

The authenticated Merchant B BFF request returned HTTP200, one statement row and `outstandingMinor=10000` after migration. Adding Merchant A's ID as a query parameter did not change scope. The reimbursement page rendered receipt `VERIFY-B-001` successfully. The separate, previously documented Merchant Terms request still fails in this preview; this change does not address it.

Local regression checks:

- **87 funded integration tests passed:** 37 multi-merchant, 38 percent/weekend, 12 accounting/security.
- The new security tests perform actual SQL SELECTs under `SET LOCAL ROLE anon` and `authenticated` against every discovered private view and require permission denial. They execute all nine view queries plus the merchant-scoped statement under `service_role` and require success.
- Hub TypeScript check passed.
- Production migration-order verification remains false; this security change does not resolve the historical ordering gap.

Sanitized local receipts are ignored files: `.verification/a01-dependency-inventory.json`, `.verification/a01-migration-result.json` and `.verification/a01-rest-access-result.json`. Credentials remain in the ignored verification environment/fixture files.

## Repeatable REST check

[verify-funded-view-access.mjs](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/scripts/verify-funded-view-access.mjs) is a read-only, explicitly configured branch integration check. Supply these environment variables through the local environment or a CI secret store:

- `FUNDED_SECURITY_PROJECT_REF`, `FUNDED_SECURITY_SUPABASE_URL`
- `FUNDED_SECURITY_PUBLIC_KEY`, `FUNDED_SECURITY_SERVICE_KEY`
- `FUNDED_SECURITY_OTHER_MERCHANT_EMAIL`, `FUNDED_SECURITY_OTHER_MERCHANT_PASSWORD`
- `FUNDED_SECURITY_OWNER_MERCHANT_EMAIL`, `FUNDED_SECURITY_OWNER_MERCHANT_PASSWORD`
- `FUNDED_SECURITY_TARGET_MERCHANT_ID`, `FUNDED_SECURITY_EXPECTED_OUTSTANDING_MINOR`

Use two synthetic merchant accounts and a known positive payable belonging to the owner merchant. The checker refuses the main project reference, enforces an exact HTTPS project URL/ref match, and has per-request timeouts. It does not create fixtures, modify database records or execute a payment. Password sign-ins establish temporary Auth sessions for the access checks.

From the workspace root:

```sh
node packages/hub-page/scripts/verify-funded-view-access.mjs
```

It is ready for a configured release check; no CI credentials or hosted CI job were added automatically.

## Production rollout

1. Review migration 160 and confirm PostgreSQL 15+ and all nine view prerequisites exist. It requires the original funding/payables/statement views, not the new multi-merchant UI or migration 159, so the access-control fix can be released independently when those prerequisites hold.
2. Apply the migration transactionally using the approved production migration procedure. Preserve its actual applied version/order in migration inventory. Do not replay the historical migration directories or apply the feature baseline export.
3. Verify effective privileges for `anon` and `authenticated`, including inherited PUBLIC access, and invoker security on all nine views. Verify server-role reads and authorized merchant/finance API functionality. Use metadata-only or explicitly approved minimal queries for production checks; the synthetic REST runner intentionally refuses production.
4. Ensure no later migration recreates the views with broad defaults without reapplying the access restrictions. Run the role-denial/dependency tests and the branch REST check as release gates.

A01 can be considered remediated on main only after that rollout and verification. The other audit findings are unchanged.

The current `verify-funded-view-access.mjs` checker was extended during A10–A12 remediation and now requires migration 165 as well as 160–164. Its 48 checks cover the bounded page/summary contract and the retired unbounded RPC; the earlier 40-check result above remains historical evidence. See [current verification and rollout notes](a10-a12-statements-discovery-remediation.md).
