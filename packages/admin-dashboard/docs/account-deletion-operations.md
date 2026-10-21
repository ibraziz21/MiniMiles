# Account deletion operations

Open **System → Account Deletions** on desktop or **More → Account Deletions**
on mobile. Only `super_admin` and `ops_admin` receive `deletions.read/write`.
Open-access development sessions cannot perform any operations.

## Deploy before enabling requests

1. Review BDR-004 and the retained evidence policy. This closes the **entire
   shared member account**, not just the native app. Review compatibility with
   the actual deployed Akiba-Platform schema and processor inventory.
2. Apply migrations 103, 105, 106 and 108 in dependency order; apply 104/107
   for reports. Migration 108 expects the dashboard's existing `admin_users`
   table and Supabase `storage.objects`. Run migrations against staging first.
3. Deploy Hub, website legal copy, native notice `.3` and Admin Dashboard.
   Old `.2` receipts require fresh verified shared-account consent; do not
   relabel their policy version in SQL. They must stay unprocessed meanwhile.
4. Configure admin server-only `AKIBA_HUB_INTERNAL_URL` and
   `ACCOUNT_DELETION_ADMIN_SECRET` to match Hub. Production requires HTTPS.
   This dedicated server credential isolates deletion from other worker callers;
   legacy deployments fall back to `INTERNAL_WEBHOOK_SECRET` only when it is unset.
5. Configure Hub's contact encryption key, Resend provider/key/verified sender,
   `ACCOUNT_DELETION_EXPIRY_ENABLED=true` and its cron, and the independent
   `/api/internal/process-account-deletion-emails` cron credentials.
6. Assign the operations team to monitor the dashboard each working day and
   arrange backup coverage. Requests have a 14-day target. The dashboard shows
   overdue requests; this change does not introduce outbound deadline alerts.
7. Enable `ACCOUNT_DELETION_ADMIN_EXECUTION_ENABLED=true` only after the
   staging rehearsal below. Then enable manual fulfilment and submission.
   Keep unattended processing off until its full inventory gate is approved.
   Presence of credentials is not proof of live email delivery.

## Handle a request

1. Open the request and **Assign to me**. Assignment and all cleanup decisions
   record the named admin. Check the original notice version and deadline.
2. **Inspect cleanup checks**. Resolve missing configuration or escalate shared
   histories, immutable ledger payloads, non-email aliases, merchant accounting
   obligations and in-flight jobs to the responsible engineering/finance owner.
   There is no force or mark-complete control.
3. When preflight is clear, choose **Run verified cleanup**, read the impact,
   and type `DELETE SHARED ACCOUNT`. The server rechecks permissions, ownership,
   policy version, lease, source data and Storage state.
4. Refresh after a lost response. Do not assume a timeout means nothing happened.
   An active run retains its lease for 15 minutes. Once it expires, the owner
   or a newly assigned eligible admin can inspect and retry. Failed database
   cleanup rolls back, while already-removed files remain removed and tracked.
   The account is frozen during actual cleanup until it is safely resolved.
5. Check **Verified**, **Completed**, evidence expiry and **Completion email**.
   Data completion and notice delivery are separate facts. Retry email only
   when due and the encrypted destination is still available; its delivery
   window ends after 24 hours. Do not fabricate a completion notice if cleanup
   is blocked or claim inbox delivery from a provider acceptance response.

## Required staging rehearsal

- Use a disposable shared member with a profile, Pass, vouchers, rewards,
  notification registrations and private/derived visit photos. Record before
  counts and Storage object checks without copying personal data into logs.
- Submit verified requests through native and the public deletion page. Confirm
  both reach this queue under notice `.3`, are idempotent on retry and respect
  paused/unavailable configuration. Deletion must not require developer SQL.
- Assign, inspect and run. Verify source file bytes/URLs disappear, public
  contributions are excluded, Pass/vouchers fail, both fresh and previously
  issued sessions lose access, and other members' entitlements survive.
- Simulate Storage failure, a late database failure, concurrent operators and
  a lost response. Verify completion cannot be recorded early and retry resumes.
- Verify before/after row counts, detached identity/projections, retained
  evidence allowlists/clocks/holds and the absence of ciphertext after delivery.
- Confirm a real completion email arrives; test provider failure independently
  of cleanup. Verify expiry and both cron schedules against the deployment.
- Record exact build/deployment revisions and results. Local tests are not
  production acceptance and do not resolve outstanding financial policy terms.

Implementation evidence is recorded in BDR-004. Resend's request-key retry
contract is documented in its [idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Local verification completed — 20 October 2026

- Admin suite: 177 tests passed. Hub suite: 985 passed. Native suite: 124 passed.
- Full isolated PostgreSQL suite: 371 passed; five legacy opt-in shared-identity
  tests skipped because no dedicated external database URL was supplied. The
  new 14-test admin deletion suite executes migrations 105/106/108 locally,
  including the actual request creator and photo/evidence schemas.
- Native, Hub and admin TypeScript/lint checks passed. Hub and Admin Dashboard
  production builds passed. The Hub live merchant-offer route was made dynamic
  so builds no longer execute that API with local sandbox payment settings.
- Synthetic browser flow passed queue/overdue display, assignment, inspection,
  typed confirmation, cancellation, verified completion, email status and
  completed history. No horizontal overflow at 320, 375, 414, 640, 768, 1024,
  1280 or 1440 CSS pixels. This is local functional evidence, not a production
  performance, accessibility or device certification.
- Database tests prove session and member-row removal, photo-chain cleanup,
  pending reward evidence/expiry clocks, bystander preservation, Storage
  verification, atomic rollback, lease conflicts, old-notice refusal, blocked
  completion shortcuts and independent notice leases. Storage calls and browser
  delivery statuses use synthetic test data; no real email was sent.

Production migrations, flags, credentials, retention/access review and the live
Supabase/Storage/email staging rehearsal above remain deployment requirements.

## Production activation — 20 October 2026

- Migration 108 was applied by the operator; `admin_deletion_fulfilment_ready()`
  returned true against the connected shared database.
- Hub and dashboard were deployed with a dedicated matching
  `ACCOUNT_DELETION_ADMIN_SECRET`, the dashboard Hub URL, contact encryption,
  Resend configuration, admin execution, evidence expiry and manual fulfilment.
  Submission was enabled only after a live authenticated inspection passed.
- Production Hub deployment `mini-miles-hub-page-fzpo8csr8-ibraziz21s-projects.vercel.app`
  was aliased to `pass.akibamiles.com`. Dashboard deployment
  `akiba-admin-figl8n8c9-ibraziz21s-projects.vercel.app` was aliased to
  `akiba-admin.vercel.app`. Connection fix: commit `e228e93`.
- Live inspection of a deliberately nonexistent request returned HTTP 200 with
  only `request_unavailable`; no configuration blockers remained and no cleanup
  ran. The signed-in Pixel 10a displayed the review notice, **Continue** and
  **Keep my account**, replacing the unavailable/support fallback.
- Six Hub endpoint tests and eight dashboard proxy tests passed, as did both
  packages' type checks, lint and production builds.
- This verifies activation and request availability. No verification code or
  deletion request was submitted for the signed-in member. Live disposable-account
  erasure, Storage removal and actual completion-email delivery remain unverified;
  retained financial exceptions still require the review described above.
