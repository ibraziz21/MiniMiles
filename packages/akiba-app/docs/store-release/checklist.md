# Akiba — store release checklist

AKIBA-MOB-002 §12, §16, §17, §18. Every row needs a named owner and a date
before submission. Rows marked **BLOCKED** cannot be completed by
engineering alone — see §20 of the spec.

Status key: `done` · `blocked` · `todo`

## Identity and accounts

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| **Canonical production host** | **blocked** | Product / Operations | | Three hosts are in play: `pass.akibamiles.com` (`MPESA_CALLBACK_URL`), `hub.akibamiles.com` (sitemap and merchant-page fallbacks), `app.akibamiles.com` (privacy/terms copy) — and `NEXT_PUBLIC_SITE_URL` currently points at `mini-miles-hub-page.vercel.app`. This blocks the store listing, the Play data-deletion URL, and the M-Pesa host-match check, because `/api/v1/config` derives privacy/terms/deletion URLs from `NEXT_PUBLIC_SITE_URL` — a vercel.app domain cannot be submitted |
| Final iOS bundle identifier | done | Product | 2026-10-15 | `com.akibamiles.akiba` |
| Final Android package name | done | Product | 2026-10-15 | `com.akibamiles.akiba` |
| Android/iOS placeholder markers cleared | done | Engineering | 2026-10-15 | Production preflight now enforces the approved identifiers |
| Apple Developer account + team, credential owner | **blocked** | Operations | | **Enrolment submitted and under Apple review as of 2026-10-19.** Until it is approved there is no APNs key, no iOS provisioning profile and therefore no iOS push at all — a free personal team cannot create an APNs key, and the Simulator cannot receive real push. **iOS is off the critical path for the first push test; Android carries it.** Record the credential owner in the private ops runbook, not in Git |
| Google Play developer account, credential owner | **blocked** | Operations | | Same |
| Expo project ID linked in `extra.eas.projectId` | done | Engineering | 2026-10-15 | Project `b0a8fd39-ca2d-4ec7-91f9-30537b945ef0` |
| Expo owning account authenticated and `expo.owner` set | done | Operations | 2026-10-15 | Linked as `@akiba-holdings-llc/akiba` |
| App Store Connect app record, display name "Akiba" | blocked | Product | | |
| Play Console app record, display name "Akiba" | blocked | Product | | |

## Build configuration

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| `eas.json` with development / preview / production / submit | done | Engineering | 2026-10-10 | `submit.production` intentionally empty — needs store ids |
| `cli.appVersionSource: remote`, production `autoIncrement` | done | Engineering | 2026-10-10 | §11.4 |
| `cli.requireCommit: true` | done | Engineering | 2026-10-10 | §11.2 |
| EAS Update disabled (`updates.enabled: false`, no channels) | done | Engineering | 2026-10-10 | §11.4 |
| `userInterfaceStyle: "light"` | done | Engineering | 2026-10-10 | §4.10 — v1 has no dark token set |
| `platforms: ["ios", "android"]`, web output removed | done | Engineering | 2026-10-10 | §4.9 |
| Expo development launcher excluded from every app artifact | done | Engineering | 2026-10-15 | `expo-dev-client` removed; local development uses the normal native debug app and shared profiles are standalone APKs |
| EAS environment variables for development / preview / production | **blocked** | Operations | | Needs the production Supabase and API hosts. **This blocks any EAS build today**: `.env` is untracked and `cli.requireCommit` is true, so a build ships without `EXPO_PUBLIC_API_BASE_URL`/`SUPABASE_URL`/`SUPABASE_ANON_KEY` and the app throws on launch (`supabase.ts` and `client.ts` both refuse to start unconfigured). Set all three per environment with `eas env:create`; they are `EXPO_PUBLIC_*`, so plaintext visibility is correct |
| Production build fails closed on a non-production host | done | Engineering | 2026-10-15 | EAS post-install preflight requires HTTPS and an `akibamiles.com` API host; rejects local Supabase URLs |
| Expo SDK package versions aligned (`expo install --fix`) | done | Engineering | 2026-10-15 | Updated to the current SDK 57 patches; `expo-doctor` 21/21 |
| Node version matches `engines` (`>=22.13.0`) | done | Engineering | 2026-10-15 | All EAS profiles pin Node 22.13.0; local verification uses the bundled Node 24 runtime |

## Native push and deep links

Added 2026-10-19 with the native push foundation (migration 101, Phase 5).
See `packages/hub-page/docs/hub-mobile-app-migration-plan.md`
§"Push notifications → Status" for what shipped.

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Device-token schema, registration API, native sender branch | done | Engineering | 2026-10-19 | `101_native_push_devices.sql`, `/api/v1/me/devices`, `adapters/native.ts` |
| Transport decision (Expo Push vs direct FCM/APNs) | done | Engineering / Product | 2026-10-19 | Expo Push; `native_device_token` reserved for a later direct path |
| APNs key + FCM credentials uploaded to Expo (`eas credentials`) | **blocked** | Operations | | Nothing has been delivered end to end without these. Keep `NATIVE_PUSH_ENABLED=false` until done. Android needs **FCM V1** (`Google Service Account` → *FCM V1*), not the Legacy API key |
| **Canonical Firebase project** | done | Engineering / Operations | 2026-10-19 | **`akiba-7bd7a`** (number 335439413857) — the project the `com.akibamiles.akiba` Android app is registered in, and the one `google-services.json` comes from. A second project, `akibamiles` (690133750705), has no Android app registered and must not be used; delete its stray service-account key `4089fb0340d7…` |
| Firebase Cloud Messaging API enabled on `akiba-7bd7a` | done | Operations | 2026-10-19 | Verified with `push:verify-fcm`: token exchange 200, `messages:send` probe 400 (authorized) |
| `google-services.json` committed and `android.googleServicesFile` set | **todo** | Engineering | | `app.json` points at `./google-services.json` and the file is now present (project `akiba-7bd7a`, package `com.akibamiles.akiba`) — but **not yet committed**, and `cli.requireCommit: true` means an EAS build will not see it. It holds only public identifiers and is safe to commit, unlike the service-account key, which is gitignored and only uploaded to EAS |
| FCM service-account key is from the same project as `google-services.json` | **todo** | Engineering | | A correct `akiba-7bd7a` key has been generated and verified locally (`push:verify-fcm` passes the cross-check and the send probe). **EAS still holds the old `akibamiles` key** — re-upload via `eas credentials` → Android → *Google Service Account* → *FCM V1* → *Set up*. `push:verify-fcm` refuses on a project mismatch before any network call, so this cannot regress silently |
| `NATIVE_PUSH_ENABLED` set per environment | **blocked** | Operations | | Gates both the bootstrap capability and device registration |
| **iOS `aps-environment` for store builds** | **todo** | Engineering | | `expo-notifications` `mode` defaults to `development`; a store build needs `production` or it receives no production APNs push. Not settable per EAS profile from a static `app.json` — converting to `app.config.js` must also update `scripts/validate-production-build.mjs`, which reads `app.json` directly. **Decide before the first TestFlight build** |
| 96×96 all-white notification icon (Android) | todo | Brand | | `icon` omitted from the plugin rather than mis-using the 1024px monochrome layer; Android currently falls back to the app icon |
| `APPLE_TEAM_ID` set so `/.well-known/apple-app-site-association` serves | blocked | Operations | | 404s until set, deliberately — iOS caches a fetched association |
| `ANDROID_CERT_SHA256` set so `/.well-known/assetlinks.json` serves | blocked | Operations | | From `eas credentials`; list both upload and Play App Signing keys during rollout |
| App-link host confirmed | done | Product | 2026-10-19 | `pass.akibamiles.com`, scoped to `/merchants/*` and `/vouchers/*` |
| Push opens the correct screen from foreground, background and terminated states (§Phase 5 exit) | todo | Engineering | | Needs credentials and a physical-device run; taps route in-process and do not depend on app-link verification |
| Expo delivery receipts polled | todo | Engineering | | `provider_ticket` is stored; nothing reads `/push/getReceipts`, so an accepted-then-failed send still reads as `accepted` |
| Notification copy reviewed for the lock screen | todo | Product / Legal | | Templates are shared with web push (`src/lib/push/templates.ts`) and already avoid amounts, receipts and identity |

## Assets and fonts

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| 1024×1024 app icon source | done (code) | Engineering / Brand | 2026-10-15 | Regenerated from the checked-in Akiba vector mark; final Brand visual approval remains |
| Android adaptive foreground + monochrome layers | done (code) | Engineering / Brand | 2026-10-15 | Transparent 1024px foreground and monochrome layers configured over Akiba teal |
| Splash validated from a preview/production build | todo | Engineering | | Not valid to check in Expo Go (§11.5) |
| FT Sterling production licence evidence **or** replacement family | done | Engineering | 2026-10-15 | Trial files removed; compatibility aliases now map to the bundled DM Sans weights |
| Store screenshots, small and large phone, both platforms | blocked | Product / Marketing | | Must match the reviewed binary |
| Feature graphic and promotional copy | blocked | Marketing | | |

## Legal, privacy and deletion

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Retention decision sheet prepared for legal | done | Engineering | 2026-10-10 | `packages/hub-page/docs/akiba-account-deletion-retention-decisions.md` — schema facts and options per row; §A's three rows must be decided before §B's eleven |
| Retention inventory approved (no `TBD` row) | **blocked** | Legal / Data protection | | **14 of 21** rows unapproved — `src/lib/akiba/accountDeletionPolicy.ts` in hub-page. Three are schema conflicts rather than missing periods, and should be decided first because they determine whether an executor is possible at all: `published_photos` (append-only `discovery_moderation_audit_events.photo_id`), `unpublished_contributions` (chained behind it), `pass_credentials` (`hub_referrals.referred_pass_id`). The other eleven are purpose/period questions legal can batch. `skill_game_prizes` was found by the static FK check, not by hand |
| Deletion submission enabled (`ACCOUNT_DELETION_SUBMISSION_ENABLED`) | **blocked** | Legal / Operations | | Off by default, and gated on the inventory. Until it is on, the app and the public page show the support fallback instead of a Continue button — requests are *refused*, not accepted-and-stranded |
| Deletion processing enabled (`ACCOUNT_DELETION_PROCESSING_ENABLED`) | **blocked** | Operations | | Off by default. Acceptance is gated on the same conditions, so the two cannot disagree |
| Completion-email transport | **blocked** | Engineering / Operations | | No email provider exists in hub-page. `isCompletionEmailConfigured()` returns false, so the delivery pass is skipped rather than burning retries; `account_deletion_reconciliation.completion_email_pending_count` surfaces the backlog |
| 14-day processing target and legal-hold copy approved | **blocked** | Legal / Support | | Published in the app and on `/account-deletion` |
| Privacy policy updated for the mobile app + deletion + on-chain | **todo** | Legal | | `packages/hub-page/src/content/legal.ts` and `packages/website/src/content/legal.ts` must change together |
| Terms updated for deletion effect on Pass/vouchers/Miles | **todo** | Legal | | Same two files |
| `/account-deletion` live over production HTTPS, returns 200 anonymous | done (code) | Engineering | 2026-10-10 | Page and flow implemented; URL verification is a deploy step |
| Deletion URL entered in Play Console | blocked | Operations | | |
| Deletion URL set as Apple User Privacy Choices URL | blocked | Operations | | Optional but recommended |
| Apple privacy declarations reconciled with the binary | **todo** | Engineering / Legal | | Worksheet: `docs/store-release/privacy-data-map.md` |
| Play Data safety form completed independently | **todo** | Engineering / Legal | | Same worksheet |
| Link check: privacy, terms, deletion, support | todo | Engineering | | §6 |

## Review metadata

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Listing copy, keywords, category | blocked | Product | | `docs/store-release/metadata.md` |
| Kenya-only availability for first rollout | blocked | Product | | §12 |
| Age rating / target audience consistent with 18+ Terms | blocked | Product / Legal | | |
| Review notes: OTP login, location, Pass QR, Miles, vouchers, no cash-out | todo | Product | | Draft in `metadata.md` |
| Durable review account or review-safe OTP procedure | **blocked** | Engineering / Support | | Reviewers cannot receive a member's email OTP |
| Export compliance, content rights, advertising, financial declarations | blocked | Legal | | |
| No mention of Gifts, Games, raffles, or push anywhere in the listing | todo | Product | | Gifts is hidden by `features.gifts` in the production config. Push now exists in the binary (migration 101) but ships switched off via `NATIVE_PUSH_ENABLED`, so it must still stay out of the listing until credentials are in place and delivery is verified on a device |

### Hub production build

Passes as of 2026-10-12. Two fixes were needed, both real:

- `GET /api/v1/vouchers` read nothing request-specific, so Next prerendered
  it during `next build`, which ran `getServerEnv()` at build time and failed
  the build on production secret validation. Now `force-dynamic` — the route's
  `s-maxage` header was always the intended caching mechanism, not a
  build-time snapshot of the catalogue.
- `MPESA_CALLBACK_URL`'s default was hardcoded to `hub.akibamiles.com`, so
  the default contradicted the host-match check whenever the site ran
  anywhere else. It now derives from `siteUrl`.

What remains is environment, not code: the production environment must supply
real secrets (`SUPABASE_SERVICE_KEY`, `GAMES_SERVICE_ASSERTION_SECRET` and
`INTERNAL_WEBHOOK_SECRET` all have minimum lengths) and `MPESA_CALLBACK_URL`
must share a host with `NEXT_PUBLIC_SITE_URL`. Run a verification build
without disturbing a dev server:

```bash
NEXT_DIST_DIR=.next-verify pnpm --filter @akibamiles/hub-page build
```

## Verification (§15.4)

CI runs the first three blocks on every push and pull request
(`.github/workflows/ci.yml`, Node 22.13.0 pinned in `.nvmrc` and the root
`engines`), including the real-PostgreSQL integration suite. Run from a clean
checkout locally:

```bash
pnpm --filter @akiba/akiba-app lint
pnpm --filter @akiba/akiba-app typecheck
pnpm --filter @akiba/akiba-app test
pnpm --filter @akibamiles/hub-page test
pnpm --filter @akibamiles/hub-page build
pnpm --dir packages/akiba-app dlx expo-doctor@latest
```

Database integration tests (require a local PostgreSQL):

```bash
pnpm --filter @akibamiles/hub-page test:integration
```

`src/__tests__/integration/account-deletion-workflow.test.ts` covers
migration 097 against real Postgres — RLS and grants, the single-live-challenge
index, first-request-wins under concurrency, lease claiming and reclaiming,
constrained status transitions, the completion-email queue with backoff and
give-up, and the refusal to hard-delete an Auth user that a request references.
It found an ambiguous `status` reference in `create_account_deletion_request`
that the mocked tests could not see and that would have failed on the first
production call.

`src/__tests__/lib/akiba/accountDeletionStepOrder.test.ts` parses the real
migration SQL and checks the worker's step order against the actual foreign-key
graph. It found three ordering defects and one entirely missing data class.

Android `expo export` passes on Node 24 and the regenerated release manifest
has been inspected: target SDK 36, `MainActivity` is the launcher, only the
`akiba` scheme is registered, updates are disabled, cleartext is absent,
and storage/overlay permissions are removed. A local AAB build reached native
compilation but Android Studio's bundled JDK 25 is incompatible with the
installed CMake/NDK toolchain; EAS uses its pinned build image and remains the
authoritative signed build path.

Still **todo**, some of which require store credentials and real devices:
iOS export, `next build` for hub-page against a fully configured production
environment, EAS preview and production builds, signed-artifact inspection,
Maestro execution (`.maestro/flows`, plus the `.maestro/scripts/` wrappers
that assert server state), and the §15.5 physical-device matrix.

## Evidence to attach to the release ticket (§18)

- [ ] Approved retention inventory and its policy version
- [ ] API/database test output and worker reconciliation output
- [ ] Before/after fixture inventory for one fully processed account
- [ ] Maestro run output and the physical-device checklist
- [ ] Resolved Expo config per EAS profile, values redacted
- [ ] EAS build URLs and artifact inspection notes
- [ ] App Store Connect and Play Console privacy/deletion screenshots
- [ ] Production link-check output
- [ ] Font licence reference or the replacement decision
- [ ] Signed-off store copy and screenshots
- [ ] Named rollback/incident owner and support escalation path
