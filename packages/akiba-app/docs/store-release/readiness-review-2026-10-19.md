# Akiba Android release readiness review — 19 October 2026

**Decision: NO-GO for Play review/public release.** Suitable to continue internal testing after producing a signed candidate. Reviewed repository commit `a0f1502`, the local working tree, anonymous production endpoints, mobile checks, backend unit tests, and available Android artifact metadata. No application code was changed.

This is a source/configuration and release-evidence review, not a completed physical-device acceptance test or a Play Console audit. Production account settings, EAS environment values, signed AAB, database integration execution, and authenticated end-to-end flows remain unverified. Existing checklist claims are not treated as fresh test evidence.

## Verified checks

| Check | Result |
|---|---|
| Mobile lint | PASS |
| Mobile TypeScript | PASS |
| Mobile unit tests | PASS: 11 files, 103 tests |
| Local production preflight with local `.env` | PASS; does not prove EAS production environment |
| Android production JavaScript/Hermes export | PASS: 1,828 modules; output `/tmp/akiba-readiness-export` |
| Expo dependency compatibility | Local SDK map PASS; network validation unavailable/offline |
| Hub TypeScript | PASS |
| Hub unit tests | FAIL: 116 files pass, 1 fails; 935 tests pass, 1 fails |
| Production `/api/v1/config` | HTTP 200; version 1.0.0; maintenance false; legal links use `pass.akibamiles.com`; Android store URL null |
| Production privacy, terms, deletion pages on `pass.akibamiles.com` | HTTP 200 anonymously; functional deletion completion not tested |
| Production Android association | `https://pass.akibamiles.com/.well-known/assetlinks.json`: HTTP 404 |
| Deletion URL printed in legal source | `https://app.akibamiles.com/account-deletion`: HTTP 404 |
| Existing preview APK metadata | package `com.akibamiles.akiba`, version 1.0.0/code 1, min SDK 24, target SDK 36; older preview lacks current camera/push permissions, so it cannot certify the current release |
| Connected Android emulator | Akiba installed with HTTPS intent filters, camera/location permissions denied and notification permission granted; bounded runtime log read had no AndroidRuntime/ReactNativeJS entries, which is not proof of crash-free operation |

Mobile lint/types/tests initially ran on host Node 20.19.1 despite the required >=22.13.0; Android export, production preflight, dependency check, backend tests and backend typecheck used the bundled Node runtime. EAS pins 22.13.0. Repeat release checks in the pinned CI environment before signing off.

## Findings in priority order

### R1 — P1: Account deletion is not releasable

Evidence: `packages/hub-page/src/lib/akiba/accountDeletionPolicy.ts` has 14 `retention: null` inventory decisions. `accountDeletionAvailability.ts:45` refuses submissions when that inventory is unapproved. `accountDeletionWorker.ts:132` implements only the unambiguous subset; missing executors fail with `step_executor_missing` at line 367. Approval and enabling flags alone will not make deletion succeed.

Impact: a new member can create an account through OTP but this checkout cannot fulfill the promised deletion workflow. A reachable landing page and a support fallback do not demonstrate the advertised automated process.

Required: Legal/Data Protection approve retention purposes, periods, and schema resolutions; Engineering implement all resulting executors/migrations and make acceptance depend on executor readiness as well as policy/flags. Run the real-PostgreSQL suite and one complete disposable-account deletion with before/after inventory, storage removal, pass/voucher revocation, session exclusion, and completion email. Verify deployment flags, worker scheduling and email delivery before opening submission. A Resend email adapter now exists; the old checklist statement that no provider exists is stale, but live credentials/delivery are unverified.

Owner: Legal/Data Protection + Backend + Operations. Release gate: successful documented full deletion through both native and web entry points.

### R2 — P1: Published legal copy points users to a dead deletion host

Evidence: `packages/hub-page/src/content/legal.ts` and `packages/website/src/content/legal.ts` direct users to `https://app.akibamiles.com/account-deletion`; that URL returned 404. The working config uses `https://pass.akibamiles.com/account-deletion`.

Required: choose and consistently publish the working canonical URL in both legal surfaces, store declarations and support instructions. Confirm all published links after deployment. Also reconcile the policy's approximate-location wording with the app's fine-location permission/current precision, and describe native photos and push processors accurately.

Owner: Legal + Engineering. Release gate: approved copy and successful live link checks.

### R3 — P1: Review access is unresolved for email OTP

Evidence: `src/app/(auth)/sign-in.tsx` signs in/creates accounts using email OTP. `docs/store-release/checklist.md` still lists a durable review account/procedure as blocked. No verified reusable review-access procedure was supplied for this review.

Required: provide a securely scoped review account and reusable reviewer access supported by the authentication system, with English instructions and seeded Pass, merchant and voucher examples. Reviewers must not depend on a team member forwarding a transient email code. Do not add a universal client-side OTP bypass.

Owner: Authentication Engineering + Support/Operations. Release gate: someone outside the team can follow the Play App access instructions unaided.

### R4 — P1 if community content ships: No native reporting/blocking controls

Evidence: `src/components/verified-visit-community.tsx` displays member photos/verified visits and supports helpful reactions and sharing. Neither this UI nor the native API client/v1 routes contains a content-report or user-block action. Moderation before publication exists elsewhere, but does not provide these user controls.

Required: confirm which UGC is accessible to the release cohort. For the shipped UGC experience, provide policy-appropriate reporting of content/users, blocking where required, accepted content rules, and an operational moderation response. Alternatively remove the community content surface from the launch candidate using an enforced capability. The anonymous discovery-contribution flag being false does not by itself prove all viewing surfaces are inaccessible to signed-in members.

Owner: Product + Engineering + Moderation. Release gate: policy review against the actual visible experience and device verification.

### R5 — P2: Android verified links cannot verify

Evidence: `app.json` declares auto-verified merchant/voucher links on `pass.akibamiles.com`; its `assetlinks.json` returns 404.

Required: publish the association with `com.akibamiles.akiba` and the correct certificate fingerprints, including the Play App Signing certificate. Test links on a Play-installed build in signed-out and signed-in states, including onboarding and invalid/expired vouchers. This is a functional release gate for promised app-link behavior, not by itself proof of a Play policy violation.

Owner: Operations + Mobile Engineering.

### R6 — P2: Backend CI is red on legal parity

Evidence: `src/__tests__/lib/legalContent.test.ts:105` fails exact parity between hub and website legal sources. Observed differences are punctuation/wording, rather than evidence of a transaction failure. Full unit output: `/tmp/akiba-hub-review-tests.log`.

Required: reconcile the approved sources and restore green CI. Do not hide the failing assertion without deciding how parity is maintained.

Owner: Engineering.

### R7 — P2: Requests can leave launch or sign-out waiting indefinitely

Evidence: the shared GET and mutation calls in `src/api/client.ts` use `fetch` without an application deadline/cancellation. Config gates the entire app; sign-out waits for best-effort device unregistration before clearing the session in `src/auth/AuthProvider.tsx`.

Impact: a stalled network can keep launch loading or delay sign-out for an uncontrolled platform timeout. Permission/channel calls in `src/push/register.ts` also occur outside its token/API exception handling, while registration is invoked with `void`.

Required: bounded request timeouts, cancellation/stale-response handling and retry UI; bound unregistration and guarantee local sign-out. Exercise slow, offline and dropped-response conditions. Catch registration permission/channel failures. Treat destructive/reward mutations carefully: timeout does not establish that a server write failed.

Owner: Mobile Engineering.

### R8 — P2: Privacy worksheet and release documents contradict current code

Evidence: `privacy-data-map.md` simultaneously describes native push identifiers and claims native push is absent/hardcoded off; describes photos as web-only despite native upload code; leaves diagnostics/SDK questions TBD. README calls the app a placeholder scaffold. Metadata still calls the finalized package identifier blocked. Checklist says submit config is empty, although Android internal submission is configured, and says no completion email provider exists despite the Resend adapter.

Required: rebuild the Data safety worksheet from the exact shipping artifact and deployed capabilities. Resolve collection/linkage/retention questions, especially bearer-authenticated coordinate requests, member photos, device tokens and SDK traffic. Finish Play Data safety and declarations from those facts, rather than copying the stale worksheet.

Owner: Engineering + Privacy + Product.

## Remaining mandatory release evidence

- Build a signed production AAB from the approved commit and EAS production environment. Local preflight is insufficient to establish remote environment correctness. Record artifact/build URL, version code and source revision.
- Inspect the final merged manifest: target SDK, exported components, backup/cleartext settings and all permissions. Confirm no development launcher, screenshot fixtures, storage/overlay/audio permissions or accidental restricted media access. SDK 57's local image-picker manifest does not declare READ_MEDIA_IMAGES/VIDEO; do not infer a restricted-permission violation from the JS permission call alone. Prefer the system picker without the unnecessary media-library permission gate for image selection.
- Verify native-library 16 KB page-size support on the final AAB and a compatible device/emulator; JavaScript export does not test native packaging.
- Run Play internal-track installation and pre-launch report. Confirm Play signing, developer identity/package registration, account eligibility and production-access requirements. If the account is subject to a closed-testing prerequisite, satisfy the Console's actual requirement before applying for production access.
- Complete real-device acceptance: fresh install/OTP/resend/expiry, first-run and returning-user onboarding, background/session expiry, Pass refresh and merchant scan, vouchers/claims/redeem and duplicate/lost responses, photo upload/cancel/withdraw, denied/approximate location, push opt-in/opt-out and tap routing from foreground/background/terminated states, shared-device logout, deletion, and upgrade/maintenance behavior.
- Check small/large screens, TalkBack, font scaling, touch targets, Android back/gesture navigation, camera-less devices, slow/offline operation and recovery. No rendered accessibility or physical-device audit was performed here.
- Confirm rollback/incident owner, backend/database deployment ordering, operational monitoring, support response and deletion-worker reconciliation. Production analytics is currently a no-op; no crash-reporting service is established by this review. Native push receipt processing and real tap routing still lack current release evidence.
- Finish exact-binary screenshots, feature graphic, approved store copy, support contact, Kenya availability, target audience/content rating, ads/app access/Data safety/financial declarations and developer/operator identity consistency. Android store URL is currently null in production config; populate it before relying on forced upgrades. Apple enrollment/APNs are not Android release blockers.

## Recommended order

1. Resolve retention decisions and implement/verify deletion; correct the dead legal URL.
2. Establish reviewer access and resolve the shipped UGC experience.
3. Fix CI, request robustness, verified links and privacy documentation.
4. Create the signed AAB; inspect native packaging and run device/internal-track acceptance.
5. Complete Console declarations/assets and attach named sign-offs to the release ticket. Submit for review only after the evidence above is complete.

## Current official references

- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Prepare an app for review and provide sign-in details](https://support.google.com/googleplay/android-developer/answer/9859455)
- [Play Console requirements](https://support.google.com/googleplay/android-developer/answer/10788890)
- [Developer policy, including UGC](https://support.google.com/googleplay/android-developer/answer/18258653)
- [Target API requirements](https://developer.android.com/google/play/requirements/target-sdk): new submissions currently require API 36; the inspected preview meets this, final AAB still needs verification.
- [16 KB page-size verification](https://developer.android.com/guide/practices/page-sizes)
- [Expo SDK 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/)
