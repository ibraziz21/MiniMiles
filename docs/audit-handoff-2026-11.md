# Audit handoff — November 2026 app, Hub and Platform work

For an independent review of the work done with Claude Code between 2026-11-10
and 2026-11-11. It says what changed, where, why, what was tested, and where
an auditor's attention is most useful. Read the code, not this summary, as the
source of truth.

## 1. What to review

| Repo | Branch | Commit(s) | Size |
|---|---|---|---|
| MiniMiles | `ft-UX-Upgrades` | `82af1ef3` (main work), `211abc75` (iOS Firebase config, checklist) | 155 files, ~11.6k lines added |
| Akiba-Platform | `merchant-mobile` | `b276ddf5` | 18 files, ~500 lines added |

```bash
git -C MiniMiles diff 0a4880e6..211abc75 --stat
git -C Akiba-Platform show b276ddf5 --stat
```

Nothing is pushed. **Commit `82af1ef3` also contains work that was already
uncommitted in the tree from Codex** and was not written or reviewed in these
sessions: the Profile library (activity, saved places, community shares,
reminders — `packages/akiba-app/src/features/profile/*`, `/api/v1/me/activity`,
`/community-shares`, `/saved-places` and their tests),
`hub-page/src/lib/akiba/purchaseEarningChannel.ts`,
`packages/admin-dashboard/sql/tests/submit_publish.sql` and
`docs/profile-redesign-implementation.md`. Audit those as Codex's own.

### Deployment state (2026-11-11)

- Database: MiniMiles migrations **121, 123, 124, 125, 126 applied to
  production**. Verified with `supabase/ops/verify_migrations_101_127.sql`
  (read-only; every row true).
- hub-page, Akiba-Platform and the app: **not yet deployed / built** at the
  time of writing.
- Remaining manual steps: `docs/launch-setup-checklist.md`.

## 2. Changes by area

### 2.1 Native app (`packages/akiba-app`)

| Change | Key files | Notes |
|---|---|---|
| Nav: floating teal Pass button on every screen; Profile at the end of the tab bar; Miles balance in its place | `components/floating-pass-button.tsx`, `components/pass-tab-bar.tsx`, `components/miles-balance-button.tsx` | |
| Sign-out returns to sign-in, not the code screen | `app/_layout.tsx` (`Stack.Protected` around `(auth)`) | |
| Onboarding redesign (BDR-007): intro carousel → email → code → profile (city tiles) → location primer → notification primer → Pass ready | `app/(auth)/*`, `app/onboarding/*`, `components/onboarding/*`, `onboarding/steps.ts`, `onboarding/intro.ts`, `push/deferral.ts` | Permission primers ask only after an in-app explanation; "Not now" defers |
| Welcome offer on Pass ready, shown only when the server returns an issued voucher | `app/onboarding/pass.tsx`, `contracts/welcome-offer.ts` | Waits up to 5 s, then falls back to the plain screen |
| Native recommendation form replacing the signed-out web visit card | `app/(tabs)/merchants/visit/[requestId].tsx`, `features/recommend/flow.ts`, `features/recommend/saved-events.ts`, `contracts/contribution.ts` | Question order mirrors the web `VisitCardFlow` |
| Store-page recommendation card above the tabs, plus a one-off sheet (14-day local cooldown) | `components/contribution-prompt.tsx`, `app/(tabs)/merchants/[slug].tsx` | |
| Notification settings per category (earnings, vouchers, referrals) | `app/(tabs)/profile/notifications.tsx` | Same preferences table as the web; orders/marketing hidden |
| "Send a test notification" | `push/test-push.ts`, `app/(tabs)/profile/settings.tsx` | Real push via Expo |
| Password change needs an emailed code (`reauthenticate()` → `updateUser({ password, nonce })`) and a confirmation field | `auth/password-change.ts`, `app/(tabs)/profile/settings.tsx` | Supabase "Secure password change" is ON |
| Merchant links opened only for `https`, `tel`, `mailto` | `lib/external-link.ts`, `app/(tabs)/merchants/[slug].tsx` | Unsafe links aren't shown as buttons |
| Firebase Analytics in release builds; screen views by route shape | `analytics/firebase.ts`, `analytics/track.ts`, `analytics/use-screen-tracking.ts`, `firebase.json`, `app.json` | No user id; ad-ID/SSAID collection off; RNFB v27 needs iOS dynamic frameworks |
| Push deep links: `/merchants/<slug>?tab=verified`, `/my-vouchers?voucher=<id>` | `push/deep-link.ts` | Still a whitelist |
| `welcomeVoucher` client flag removed | `contracts/config.ts` | Replaced by the server result |

### 2.2 Hub (`packages/hub-page`)

| Change | Key files |
|---|---|
| Expo delivery receipts poller (every 15 min): marks ok/error/expired, retires `DeviceNotRegistered` devices, logs credential errors | `lib/push/receipts.ts`, `app/api/internal/process-push-receipts/route.ts` |
| Push health snapshot (counts only) | `lib/push/health.ts`, `app/api/internal/push-health/route.ts` |
| Member test push (5/hour) | `lib/push/testPush.ts`, `app/api/v1/me/devices/test-push/route.ts` |
| Miles-earned rollout: allowlist matches id or email; percentage bucket by user id only, so app and sender agree | `lib/akiba/milesEarnedNotificationsRollout.ts`, `lib/akiba/milesEarnedNotification.ts`, `lib/capabilities/resolveCapabilities.ts` |
| "How was it?" push after an in-store verified earning; suppressed at send time if the request closed | `lib/akiba/contributionRequestNotification.ts`, `lib/akiba/discoveryEarningIngestion.ts`, `lib/push/dispatch.ts` |
| New offer at a saved place (scanner every 15 min) | `lib/push/offerAlerts.ts`, `app/api/internal/process-offer-alerts/route.ts` |
| Voucher expiring reminder (hourly) | `lib/push/voucherExpiry.ts`, `app/api/internal/queue-voucher-expiry-reminders/route.ts` |
| Push copy for the three new templates | `lib/push/templates.ts` |
| Welcome offer enrol/read endpoint (enrols only for bearer-token, i.e. app, callers) | `lib/akiba/welcomeOffer.ts`, `app/api/v1/me/welcome-offer/route.ts` |
| Funded-offer catalogue lists only `self_claim` allocations | `lib/vouchers/catalogue.server.ts`, `lib/vouchers/merchantFundedOffers.server.ts` |
| Native recommendation endpoints; web PUT now shares validation and RPC mapping | `lib/discovery/contributions.ts`, `app/api/v1/me/discovery-contributions/[id]/route.ts`, `.../merchant/[slug]/route.ts`, `app/api/me/discovery-contributions/[id]/route.ts` |
| Account deletion policy lists `welcome_offer_enrolments` | `lib/akiba/accountDeletionPolicy.ts` |
| Crons added | `vercel.json` |

### 2.3 Database (`supabase/migrations`)

| Migration | What it does |
|---|---|
| 123 | `enqueue_web_push_job` whitelists `contribution_requested`, held 45 min via `available_at` |
| 124 | `native_push_deliveries.receipt_status/receipt_error/receipt_checked_at` + partial index |
| 125 | `hub_offer_sightings`, `hub_offer_sighting_sources` (first scan per source is a silent baseline), `record_offer_sightings` (≤1 push/member/day, saved before the offer appeared, 09:00–21:00 Nairobi); `hub_voucher_expiry_reminders`, `queue_voucher_expiry_reminders` (2–26 h before expiry, vouchers that lived >48 h, grouped per member); trigger whitelists both templates |
| 126 | `welcome_offer_campaigns` (one `enrolling` at a time; validation trigger: auto_award only, not self_claim, percent_off with cap), `welcome_offer_enrolments` (unique per canonical id, ever), `enrol_welcome_offer`, `get_welcome_offer`; **`claim_akiba_funded_voucher_atomic` carried forward from 113 with only the `auto_award` gate changed** |

Decisions are recorded in `docs/BDR-007-onboarding-intro-and-permission-primers.md`
and `docs/BDR-008-new-user-welcome-offer.md` (including the §6 amendments:
award on reaching the last onboarding step, and the KES 1,000 minimum spend
the engine requires).

### 2.4 Akiba-Platform (`b276ddf5`)

| Change | Key files |
|---|---|
| Only `super_admin`, `admin`, `finance` staff may POST purchase events, refunds or `rewards/issue` (ops/support/viewer keep reads) | `api/lib/purchaseRewards.ts`, the three route files |
| `voucher-funding-expiry-worker` scheduled every 15 min (it existed but nothing ran it) | `api/vercel.json` |
| `webhook-worker` accepts Vercel Cron's GET + `CRON_SECRET` (cron calls were 405/401); `reward-worker` scheduled, drains ≤20/run | `api/lib/workerAuth.ts`, both route files |
| Till amount ceiling KES 1,000,000 (scan-award, redemption, and `rewards/issue` schema) | `dashboard-merchant/lib/till-limits.ts`, `shared/schemas/reward.ts` |
| Till/`rewards/issue` purchase time within 90 days back / 5 min ahead | same files, `api/app/api/v1/rewards/issue/route.ts` |
| Public funded-offer listing shows only `self_claim` allocations | `api/app/api/v1/voucher-funding-allocations/route.ts` |
| Miles-notification worker sends purchase channel so in-store visits open recommendation requests | `api/lib/milesNotificationDelivery.ts` |

## 3. Where to look hardest

1. **Migration 126's claim RPC.** Diff it against 113 — only the `auto_award`
   gate and the COMMENT should differ. The gate trusts
   `current_setting('akiba.welcome_enrolment')`, set only inside
   `enrol_welcome_offer`. Is there any other path (a SECURITY DEFINER function
   running dynamic SQL, a service-role SQL endpoint) that could set it?
2. **`enrol_welcome_offer` concurrency and rollback.** Member advisory lock,
   campaign `FOR UPDATE`, claim inside a `BEGIN … EXCEPTION` block. Check a
   refused or failed claim leaves no voucher, ledger row or enrolment, and
   that two simultaneous enrolments can't both pass the cap. `detail`
   (SQLERRM / claim error code) is logged by the Hub, never returned to the
   member — confirm.
3. **Native-only enrolment** rests on `authMode === 'bearer'`. Any web or
   third-party caller with a bearer Supabase token could enrol a qualifying new
   account. Acceptable per BDR-008 §4? The new-member rule (account created
   after the campaign started) still applies.
4. **Migration 125 SQL**: temp tables inside SECURITY DEFINER functions under
   PostgREST; the per-member daily cap keyed on `notification_outbox.user_ref`;
   quiet hours; that a source's first run never announces existing offers.
5. **Web recommendation route refactor.** Response shapes and status codes for
   `/api/me/discovery-contributions/:id` PUT should be unchanged
   (`{ ok: true, contributionId }`, same error strings). Confirm.
6. **Push receipts**: 24 h expiry, device retirement, and that
   `processPushReceipts` can't mark another member's delivery.
7. **Platform staff-role choice** (`finance` included, `ops` excluded) and the
   1,000,000 cap now applying to every partner using `rewards/issue`.
8. **`reward-worker` GET loop**: each request leaves `pending` on pickup;
   confirm no path leaves one pending so the loop repeats it.
9. **App password change**: the code is sent as `nonce`; server enforcement
   depends on the Supabase setting (now on).
10. **Analytics**: everything goes through `scrubProps`; no user id; screen
    names are route shapes. Look for any call site that puts an id in an event
    name or a non-blocked key.

## 4. Tests and checks run

| Package | Result |
|---|---|
| akiba-app | 180 tests pass; `tsc` and ESLint clean |
| hub-page unit | 1,308 pass; **4 failures that predate this work** (`legalContent`, `merchant-save` ×2, `catalogue-freshness`) |
| hub-page integration (real Postgres) | Pass for 123, 124, 125 (16 tests), 126 (14 tests, against the real funded-voucher engine), push dispatch, funded vouchers. `funded-secondary-merchant-accounting` fails because `migration-order.json` is out of date (also predates this work) |
| Akiba-Platform api unit | 316 pass; `tsc` clean. Integration tests (need a database) not run |
| Akiba-Platform dashboard-merchant | 458 pass; `tsc` and lint clean |
| Akiba-Platform shared | 254 pass |

```bash
pnpm --filter akiba-app test
pnpm --filter @akibamiles/hub-page exec vitest run
pnpm --filter @akibamiles/hub-page test:integration   # needs local Postgres
(cd Akiba-Platform/packages/api && npx vitest run __tests__/unit)
(cd Akiba-Platform/packages/dashboard-merchant && npx vitest run)
```

## 5. Known gaps (not done)

- Nothing was tried on a phone: onboarding, the recommendation form,
  notification settings, the Security sheet, Firebase Analytics.
- Akiba-Platform low-severity findings left open: a redemption retry without
  `occurred_at` could conflict (latent); `resolveCaller` assumes one business
  per user; directory moderation validates the body before the staff check;
  in-memory rate limits without Redis.
- The app has no "Not now" that dismisses a recommendation request server-side
  (only a local cooldown).
- Saved-place alerts key on the offer, so adding a merchant to a running
  funded offer doesn't alert that merchant's savers.
- `packages/hub-page/src/__tests__/integration/helpers/migration-order.json`
  is missing MiniMiles 115–126 and Platform 166–171.
- Supabase custom domain (`auth.akibamiles.com`) decided but not started.
- `001onboard.zip` (design export) sits untracked at the repo root.
