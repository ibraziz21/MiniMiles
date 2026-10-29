# Release test triage — 29 October 2026

The 12 previously reported unit failures were reproduced, diagnosed and resolved. No application behavior or database state was changed by this triage.

| Failures | Cause | Correction |
| --- | --- | --- |
| Directory contact: 1 | The fixture omitted the current `directory_updated_at`, so the real optimistic-concurrency guard correctly rejected the request. | Supply a matching instant in `Z` form while the request uses `+00:00`; add a genuinely stale-token rejection test. |
| Directory presence: 1 | The Supabase mock had no implementation for the version-token read. | Supply the current settings token through the actual query chain. |
| Discovery media: 9 | Fixtures predated the required idempotency key, rate-limit RPC, pre-publish ownership/readiness reads, private derivative downloads and signed URLs. The deletion fixture also returned the pre-removal row. | Model the current contracts, dispatch limiter responses separately from business RPC responses, return signed private URLs for unpublished media, and return the removed row after deletion. |
| Hub deletion request: 1 | The assertion expected `hello@akibamiles.com`; the current deletion page, error message and completion email use `hello.akibamiles@gmail.com`. | Assert the current published contact while retaining the existing 503, no-request-write and no-challenge-consumption checks. |

Added guard cases prove missing upload idempotency keys return 400 without allocating storage, exhausted upload limits return 429 without allocating storage, and stale directory versions return 409 before the mutation RPC. Media publication error tests now explicitly assert the publishing RPC was reached, so an earlier unrelated 409 cannot satisfy them. The real rate-limit helper and directory concurrency guard are exercised; neither was disabled.

Typechecking additionally found an inference cycle in the new 10,001-row pagination benchmark's `rows` variable. An explicit row type and nonempty-page tail variable resolve it; SQL and runtime behavior are unchanged.

## Final verification

- Full merchant unit suite: **331 passed**, 41 files, no failures.
- Full Hub unit suite: **1,127 passed, 1 skipped**, 133 files, no failures.
- Merchant and Hub TypeScript checks: passed.
- Strengthened media assertions: 22 tests passed after the full-suite run.
- Diff whitespace checks on the triage changes: passed.

Ignored evidence: `.verification/release-triage-merchant-before.log`, `release-triage-hub-before.log`, `release-triage-merchant-full.log`, `release-triage-hub-full.log`, both `release-triage-*-types.log` files and `release-triage-media-final.log`.

These failing-test items no longer block release. The next pre-deployment gate is the complete admin → customer claim → secondary-merchant redemption → reimbursement acceptance journey on the verification branch. Production database reconciliation/migrations, coordinated app/worker deployment and production smoke checks remain rollout tasks. This triage did not deploy anything or establish mailbox deliverability.

The subsequent complete branch acceptance journey is now recorded in [Karen Flea Market acceptance](karen-flea-market-acceptance-2026-10-29.md), including the additional real admin defects it uncovered and repaired.
