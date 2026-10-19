# Account deletion implementation and rollout

## Current state — 2026-10-19

**Scope was narrowed by the user to native-app data, with shared-account effects reviewed first.** See [the shared impact review](akiba-native-deletion-shared-impact-review.md). Shared Auth, wallet/canonical identities, usernames and the global ledger are preserved. The end-to-end account lifecycle remains blocked in code and SQL; configuration flags alone cannot activate it.

The agreed working periods are now executable policy constants and are also recorded on inventory rows independently of the remaining formal retention terms. Migration `103_account_deletion_evidence.sql` stages the following behavior; it has not been applied to production and no production switches have been enabled.

- Restricted evidence snapshots with explicit field/value allowlists; no direct table access for ordinary users, merchants or the general service-role client.
- Source/derived photo removal remains in the Storage worker. The database step transfers minimal moderation evidence and removes the source audit/photo/contribution/request chain, with an explicit narrow exception to audit immutability. Ordinary audit mutation remains forbidden.
- Referral identity/Pass/code/click detachment, cancellation of pending jobs, preservation of the other member's completed reward and 180-day expiry of retained referral evidence.
- Native spend/earning/redemption/voucher snapshots and cleanup where the dependency preflight permits it; incomplete spends and separate merchant obligations are refused.
- Security evidence minimization, notification-history cleanup and removal of native device registrations. Printed Pass resolution rejects a pending account immediately, and accepted requests void unused vouchers and disable referral codes.
- Read-only dependency checks against the real Akiba-Platform identity schema. The scoped ledger-removal implementation was removed after the user narrowed the release. A pinned copy of Platform migration 003 tests that ordinary ledger immutability and shared identity rows are preserved.
- Shared Auth deletion is excluded from the executor registry. The original Auth foreign key remains; no Auth hard/soft-delete call is made by the new worker. Completion proof can be detached without deleting shared Auth, but native membership lifecycle isolation is still required before activation.
- Retention clocks start at successful completion: moderation 90 days; reward/security/referral evidence 180 days; proof 24 calendar months. Holds prevent expiry. The expiry route has its own default-off switch, independent of new request processing.
- Encrypted completion contact has a 24-hour operational delivery window after completion; sender claim and expiry both clear an expired address, including when a provider is unavailable. Deletion does not reopen because mail fails.
- Native notice no longer presents blockchain records as a native-app feature. Both shared legal surfaces use the working deletion host and same versioned copy. Native acknowledgement sends the notice version bundled in the binary rather than blindly echoing a newer server version.

## Explicitly unfinished: shared-service histories

This is a staged implementation, **not a declaration that full account deletion is ready to enable**. Inspecting `/Users/ibraziz21/Desktop/Work/Akiba-Platform/packages/api` and its migrations established additional histories beyond the original Hub inventory. The preflight refuses these instead of accepting a request that cannot safely finish:

- Non-native identity aliases/shared canonical ownership, on-chain ledger entries, and unhandled canonical tables.
- Platform purchase/identity histories, direct-addressed rewards, legacy profiles and ledger foreign-key dependents such as refunds/referral-credit records that need their own cleanup handlers.
- Actual shared M-Pesa or game-prize rows and merchant settlement obligations. Their existence in schema is not evidence that the native app takes money payments or includes Games.
- In-flight spend, referral or photo work that still needs reconciliation.

In particular, real native merchant earning/voucher flows can create Platform purchase, claim or acquisition rows. They must receive explicit handlers and integration fixtures before rollout; these are not rare edge cases that can be ignored. The current preflight refusal is a safety boundary during implementation, not an acceptable final store-release experience.

Next is to implement an independent native membership lifecycle and confirm which companion-web/Hub records belong to it. Review shared identity and other parties' transaction obligations before considering any broader handlers; do not implement whole-account deletion under the native-only instruction. The Platform base schema is owned by its repository; apply schema changes in the shared database once, with migration coordination. Do not copy a native 180-day rule onto money-payment or game-prize records without resolving their distinct scope/purpose.

Some metadata also remains unverified: exact retained-field/dispute lookup requirements for those classes, actual processor inventory, Supabase storage/backup region and retention, operational role assignments and legal/necessity terms. The `retention: null` gate remains intentional. Accepted product periods are not being asked again; they are represented by `workingPeriod` and `DELETION_RETENTION`.

## Deployment sequence once remaining work is complete

1. Apply coordinated shared-schema migrations in a staging database containing representative native and legacy records. Migration 103 expects Hub migrations through 102 plus the shared Platform identity/ledger base tables. Do not run it against production during code review.
2. Configure completion email/encryption and verify delivery without recording plaintext contacts in logs. Confirm processor/backup behavior and operational roles.
3. Run the worker and daily expiry against disposable fixtures, including moderated photos, completed and pending referrals, native merchant Miles, free/Miles/funded vouchers, private notifications, shared histories, failures/retries, concurrent writes, holds and expiry. Inspect exact retained field sets and residue; the old direct-column residue harness alone is insufficient for indirect/canonical references.
4. Verify that every executable inventory row has a real handler, every required term is resolved and acceptance-time preflight has no unsupported normal native flows. Do not manually populate fake retention terms to bypass this gate.
5. Update the implementation verification marker when code/schema contracts change. Only after successful staging evidence, set `ACCOUNT_DELETION_IMPLEMENTATION_VERIFIED=2026-10-19.1` and `ACCOUNT_DELETION_EXPIRY_ENABLED=true`. This marker is an operator attestation, not automatic verification of a deployed migration.
6. After native lifecycle review and implementation, verify the expiry cron is authenticated and actually runs. Its route is `/api/internal/expire-account-deletion-evidence`; it remains active when new deletion processing is paused. Verify holds, expired contact purge, 90/180-day evidence removal and 24-month proof removal.
7. Deploy matching notices/policy version and binaries. Enable processing/submission only after the full staging/device checks. An unavailable deletion path is still a Play Store blocker.

## Verification performed in this implementation pass

- Mobile lint, TypeScript and 103 mobile unit tests pass.
- Backend unit suite: **943 tests pass** (118 files).
- Full PostgreSQL suite: **351 tests pass** (9 files), including the 44 targeted deletion tests. The existing spend-intent fixture was corrected to reuse the canonical automatically created by migration 099, resolving six duplicate-email fixture failures.
- These results are code/database checks, not proof of a production migration, delivered completion email, activated native membership deletion or full shared-account deletion, real-device flow or store approval. Latest command output is held in `/tmp/akiba-deletion-unit.log` and `/tmp/akiba-deletion-db.log` during this local session.
