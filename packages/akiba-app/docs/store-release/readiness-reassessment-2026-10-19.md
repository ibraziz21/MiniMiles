# Android readiness reassessment — 19 October 2026

Verdict: substantial implementation progress; not ready for Play submission.
This reassesses the current working tree and public production endpoints.
It does not certify Play Console settings, production secrets, database deployment,
signed artifacts or physical-device acceptance. No deployment or account mutation
was performed for this review. The earlier review remains a historical baseline.

## Fresh evidence

- Mobile lint and TypeScript pass; 124 tests pass across 13 files.
- Backend TypeScript passes; 966 unit tests pass across 119 files.
- `git diff --check` passes.
- Production `/api/v1/config` returns 200, maintenance false, correct pass-host
  legal URLs, but policy version `2026-10-10.1`; local notice is `2026-10-19.2`.
- Production privacy, terms and deletion pages return 200. Privacy and terms
  still contain `app.akibamiles.com/account-deletion`; both local legal sources
  have already corrected this. Deployment is therefore still required.
- Production `/.well-known/assetlinks.json` returns 404.
- Production Android store URL remains null.

The previously reported 351 database tests are historical evidence. They were
not rerun in this reassessment and do not certify new migration 105. Its new
integration suite skips without `DELETION_INTEGRATION_DB_URL` and expects a
prepared database; ordinary unit-test success does not establish migration safety.

## Improvements since the baseline

| Area | Current evidence | Remaining gate |
|---|---|---|
| Reviewer authentication | Native password sign-in implemented | Confirmed, seeded reviewer account; independent login test; Console instructions |
| Community reports | Native report UI, API, migration 104 and tests present | Deployed schema/API, real report-to-moderator-to-resolution test, blocking policy resolution |
| Request reliability | API uses 15-second AbortController wrapper | Deadline does not cover response body consumption; stalled-body/device tests remain |
| Sign-out | Best-effort unregistration and raced Auth revoke added | Local-clear behavior and shared-device notification isolation need device verification |
| Privacy worksheet | Native photos, system picker and push identifiers documented | Diagnostics/SDK TBDs, authenticated location linkage, final-artifact validation and Console form |
| Legal parity | Local sources agree; unit tests pass | Deploy and verify published copy |
| Deletion evidence | Referral FK, controlled moderation cleanup, restricted evidence, expiry, working periods and calendar-aware policy model staged | Full terms/scope, deployment and complete disposable-account proof |
| Completion email | Resend adapter and verification script present | Verified sender/credentials and actual delivered notice; provider selection alone is insufficient |

## Submission blockers

1. **Deletion is still intentionally blocked.** Eighteen of 23 inventory rows
   have null formal terms, and preflight unconditionally includes
   `shared_account_scope_review`. Working periods are accepted; this count is
   not 18 unanswered retention-duration choices. It also includes scope,
   columns, processor/region and access-control contracts.
2. **The new shared-identity implementation conflicts with the last native-only
   scope instruction.** Untracked migration 105 and BDR-002 add wallet unlinking,
   shared username removal, identity-link removal and direct `auth.users`
   deletion. BDR-002 still acknowledges scope approval is pending. Do not deploy
   or activate this as an approved native-isolation implementation. Resolve the
   scope, align notices/terms/executors and test recovery before activation.
   Removing the preflight blocker is not a sufficient fix.
3. **Published legal copy remains stale.** Deploy corrected Hub/website copy,
   then recheck every published deletion URL and policy version.
4. **UGC is not closed by report capture alone.** `countPendingReports` has no
   application caller in the inspected source; no moderator-facing report queue
   was found. Prove timely review/action and terms acceptance. Migration 104's
   anonymous-content rationale is not an explicit Google policy exemption for
   blocking publicly accessible UGC; implement appropriate controls, obtain a
   defensible policy resolution, or enforce removal of the launch surface.
5. **Reviewer access remains operationally unproven.** The password mechanism
   is fixed; the review account and unaided instructions still need evidence.
6. **Privacy declarations remain incomplete.** Diagnostics and some SDK entries
   remain TBD. Coordinates are sent with bearer authentication, so the worksheet's
   claim of no identity linkage cannot be justified merely by absence of profile
   storage. Fine location is still requested; assess necessity or accurately
   disclose it. No final Data safety submission was inspected.
7. **Signed release and Console acceptance are unverified.** Need the exact
   production AAB/environment/revision, merged manifest, native 16 KB support,
   Play-installed internal-track tests/pre-launch report, reviewer credentials,
   screenshots/listing/declarations, and Console eligibility/testing prerequisites.

## Remaining functional checks

- Publish Android asset links using the correct signing certificates and test
  Play-installed merchant/voucher links across authentication states.
- Push delivery has prior recorded evidence, but real foreground/background/
  terminated tap routing, receipt reconciliation and shared-device logout still
  lack fresh acceptance evidence. Permission/channel exceptions remain outside
  registration's try/catch, and callers invoke registration without a catch.
- The fetch timeout clears on response headers, before `response.json()`; a
  stalled body can still leave a screen waiting. Cover complete response reads.
- Verify local logout under network loss rather than assuming an SDK method
  named `scope: local` performs no network work.
- Run the full fresh-install/session/Pass/voucher/photo/location/push/deletion
  matrix, offline recovery, TalkBack/font scaling and upgrade/maintenance paths.
- Confirm deployment ordering, deletion reconciliation/expiry schedules, support
  and rollback ownership. The checklist still contains stale statements such as
  no email provider, an empty submit configuration and a non-canonical host.
- No native real-money checkout was identified. Reconcile final financial
  declarations against the actual release features; this is not a blanket
  certification of billing-policy applicability to future features.

## Policy references checked

- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111): an in-app path may link to a web resource; customer-service requests can be supported. Automation is not itself required. A support route needs a real, tested fulfillment process; the disabled worker alone is not proof of compliance or of noncompliance.
- [Google UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937): terms acceptance, ongoing moderation and applicable reporting/blocking controls remain required for the shipped experience.

Recommended order: settle deletion scope and prove fulfillment; deploy legal
copy and report operations; verify reviewer access and privacy declarations;
then attach exact-build/internal-track/Console evidence before submission.
