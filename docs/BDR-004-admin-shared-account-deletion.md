# BDR-004 — Verified shared-account deletion through Admin Dashboard

Date: 19 October 2026. Decision owner: Ibrahim.

The user explicitly chose **“Entire shared Akiba account”** when asked whether
the dashboard action should preserve the shared login or close it. This
supersedes the native-only scope in BDR-003 and the earlier scope decision log.
It does not authorize destroying merchant obligations or inventing financial
retention schedules. Unsupported histories stop cleanup for review.

The manual request path now feeds **System → Account Deletions**. A named
super-admin or operations admin assigns the request, inspects preflight, then
confirms full shared-account erasure. The old procedural mark-complete function
is disabled by migration 108. A completion trigger also refuses completion of
manual/admin-managed requests without a verified case.

## Execution contract

- New member-facing policy/notice version: `2026-10-19.3`. Older native-only
  acknowledgements are refused by cleanup and require fresh verified consent;
  administrators must not edit a version field to bypass this check.
- Manual admission requires configured admin execution, email, contact
  encryption and expiry, plus the deployed readiness RPC and at least one
  active eligible admin. The submission switch remains the incident kill switch.
- Scope approval removes only the old unconditional scope exclusion from the
  operator preflight. Existing merchant/payment/prize/on-chain/shared-history
  and in-flight-work blockers stay effective. Non-email canonical aliases still
  require review; this slice does not guess how other products use them.
- Before starting, verify the encrypted completion destination can be read.
  Capture a protected Storage manifest and freeze account writes. A 15-minute
  execution lease serializes operators; an interrupted run can be resumed after
  expiry. Automated workers cannot claim admin runs: the request's worker lease
  is infinity while the separately managed admin lease is finite.
- Delete objects using Supabase Storage's API, never SQL-delete its metadata
  to simulate file deletion. Keep the manifest across failed/lost responses.
- Database cleanup, restricted evidence snapshots, verification, Auth removal,
  completion clocks and audit events commit in one transaction. Any failure
  rolls back database cleanup and does not report completion. Storage removal
  may already have happened; retries safely resume from the durable manifest.
- Verify member-linked rows, identity and username projections, Auth removal,
  and absence of Storage objects. Unknown member-linked schemas, shared Storage
  references and arbitrary immutable ledger notes/hashes stop the run.
- Ledger rows with no identifying payload and no unresolved source/dependency
  blockers remain immutable under unmapped canonical IDs. They are retained
  Platform evidence, not claimed as erased or anonymous. The final financial
  necessity/access/retention schedule remains a deployment policy requirement.
- Accepted native evidence clocks remain 90 days moderation, 180 days
  security/rewards/referrals, and 24 calendar months for restricted proof.
  Existing expiry/hold controls apply. The transient Storage manifest and run
  token are removed on successful verification.
- Completion email has its own leases and retries. A mail outage never reopens
  finished cleanup. Its independent cron runs even when unattended processing
  is disabled. Resend retries use an opaque request-based idempotency key.

## Scope of readiness

The feature is staged, default-off. No migration, flag, actual account deletion
or real email delivery was performed in production while implementing it.
Release activation still needs staging acceptance with real Supabase Storage,
Auth and email, reviewed retained-evidence terms, schema compatibility with the
deployed Platform, matching notice deployment, and operations ownership.
