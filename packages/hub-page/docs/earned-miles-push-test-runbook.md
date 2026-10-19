# Testing the earned-Miles push flow

How to test "merchant scans → member gets a native notification", and what
can be tested before Expo push credentials exist.

The chain is longer than it looks, every link fails quietly, and one failure
mode is actively misleading (Expo accepts a send with no credentials
configured, so the job completes as `accepted` and no banner ever appears).
So test it in three phases rather than hoping the whole thing works at once.

## The chain

```
Merchant dashboard (Akiba-Platform — separate repo)
  │ scans the Pass, awards Miles, commits its own ledger
  ▼
POST /api/internal/miles-credited          Authorization: Bearer AKIBA_API_KEY
  │ validates the MilesCreditedEvent contract
  ▼
produceMilesEarnedNotification()           src/lib/akiba/milesEarnedNotification.ts
  │ GATE: isMilesEarnedNotificationEnabledFor(hubUserId, merchantId)
  │ enriches with the Next Reward snapshot, picks the deep link
  ▼
notification_outbox                        template 'miles_earned', category 'earnings'
  │ TRIGGER resolve_notification_recipient → enqueue_web_push_job
  ▼
web_push_jobs                              one job per notification, both transports
  │ cron GET /api/internal/process-push-jobs, every minute (vercel.json)
  ▼
processPushJobs()                          src/lib/push/dispatch.ts
  │ renders the template, checks hub_notification_preferences.earnings_enabled
  ├──► adapters/web.ts    → web_push_subscriptions  → VAPID    → browser
  └──► adapters/native.ts → hub_user_devices        → Expo     → APNs/FCM → phone
```

Only the member's own device registration and the two transports differ; the
queue, the retry/backoff and the preference decision are shared.

## Which device can demo this

| Target | Real FCM/APNs push? | Needs |
|---|---|---|
| **Android emulator** with a Play Store image | **yes** | A `google_apis_playstore` system image. A plain AOSP image has no Play services and cannot receive FCM |
| Android physical device | yes | — |
| **iOS Simulator** | **no** — but see `push:simulate-ios` below | — |
| iOS physical device | yes | Approved paid Apple Developer Program membership |

So the full end-to-end demo runs on an **Android emulator**. iOS needs an approved
Apple account for real push; until then the Simulator covers everything except
the transport.

### Simulating a *remote* notification on the iOS Simulator

`expo-notifications` derives `content.data` differently for remote and local
notifications — `NotificationRecords.swift`:

```swift
let isRemote = request.trigger is UNPushNotificationTrigger
if isRemote { return request.content.userInfo["body"] as? [String: Any] }
return request.content.userInfo
```

So a remote payload must nest its data under a top-level `body` key, which is
exactly what Expo's push service does with the `data` field the native adapter
sends. `scripts/simulated-remote-push.apns` reproduces that shape, so pushing it
into the Simulator exercises the real remote path — the response listener and
the deep-link whitelist — with no Apple account and no APNs:

```bash
pnpm --filter @akiba/akiba-app push:simulate-ios
```

The app must be installed on the booted Simulator. This is the closest you can
get to a real iOS push without an approved account; what it still cannot prove
is the APNs transport itself.

## Phase 1 — the app half, today, with no credentials

This needs nothing from Expo and proves every piece of the app: notification
permission, the Android channel, the foreground handler and banner, the tap
listener, and the deep-link whitelist routing to the right screen.

1. Build a development build — **Expo Go will not work**, because
   `expo-notifications` is a native module and `app.json` gained its config
   plugin:

   ```bash
   pnpm akiba-app:ios     # or: pnpm akiba-app:android
   ```

   Two things to know before choosing local vs EAS:

   - A **local** `expo run:android` needs **JDK 17** on `PATH`. The project
     breaks on 24+ (AGP 8.12 with prefab/JNA), so the generated JDK 25 pin
     does not work. EAS Build uses its own pinned image and sidesteps this.
   - An **EAS** build needs the `EXPO_PUBLIC_*` variables set as EAS
     environment variables. `.env` is untracked and `cli.requireCommit` is
     true, so an EAS build gets none of them and the app throws on launch.
     Set them once per environment:

     ```bash
     cd packages/akiba-app
     npx eas-cli@latest env:create --environment development \
       --name EXPO_PUBLIC_API_BASE_URL --value https://pass.akibamiles.com \
       --visibility plaintext
     # repeat for EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
     ```

   Also note `cli.requireCommit: true` means EAS builds the **committed**
   tree — uncommitted work is simply not in the build.

   The in-app *Send a test notification* row is gated on `__DEV__`, which is
   false in a standalone EAS build. It appears only in a local debug build.
   The end-to-end demo does not need it; it uses the real push path.

2. Sign in and finish onboarding. The permission prompt is deliberately
   behind the onboarding gate, so it appears on the first tab render, not at
   cold start.

   The prompt only appears when the Hub reports `capabilities.nativePush`,
   which is `NATIVE_PUSH_ENABLED=true`. With it off, the app correctly never
   asks and never registers.

3. **Profile → Settings → Notifications → "Send a test notification"**
   (development builds only; `__DEV__` keeps it out of any release binary).

   It fires a *local* notification whose `data` payload is byte-for-byte what
   `buildPushPayload()` produces, so the tap takes the real routing path.

   Expect: a banner, and tapping it lands on the voucher purchase screen.

What this does **not** prove: that a token was registered, that Expo accepted
anything, or that credentials work. A local notification never leaves the
phone.

## Phase 2 — the server half, today, with no credentials

```bash
cd packages/hub-page

# Which of the eleven gates is currently blocking?
pnpm push:doctor --user <hubUserId> --merchant <merchantId>

# Fire the same event Akiba-Platform posts, then drain the queue.
pnpm push:simulate --user <hubUserId> --merchant <merchantId> --miles 250 --inspect
```

`push:simulate` is a **write** against whatever it points at: it creates a
real outbox row and a real job for a real member, and if everything is
configured it really does notify them. Point it at staging and a test
account.

It reports the exact shape of each failure:

| What you see | What it means |
|---|---|
| `401` from miles-credited | `AKIBA_API_KEY` mismatch between here and Platform |
| `notified: false` | The rollout gate declined. The credit is real; no notification will ever exist. Nothing downstream is broken |
| `claimed: 0` | The enqueue trigger made no job — check migration 069 is applied |
| `suppressed > 0` | Template did not render, or the member switched the earnings category off |
| `configErrors > 0` | No usable transport, or the provider rejected every send on credentials |
| `retried > 0` | A transport failed retryably; see `native_push_deliveries.last_error` |
| `accepted > 0` | Expo accepted it. **Not proof of delivery** — see the warning above |

The database guarantees are covered without any of this:

```bash
pnpm --filter @akibamiles/hub-page test:integration   # includes native-push-devices
```

### The gate that catches people

`produceMilesEarnedNotification` passes **`hubUserId`** as the rollout
identifier, even though the function's own doc comment says "prefer email".
So for a deterministic test, put the member's **UUID** — not their email — in
`HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST`. An allowlist entry short-circuits
the percentage bucket.

```bash
HUB_MILES_EARNED_NOTIFICATIONS_ENABLED=true
HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST=<member-uuid>
# Leave the merchant allowlist unset. While it is set it overrides the member
# percentage entirely, and only those merchants' credits notify.
HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST=
NATIVE_PUSH_ENABLED=true
```

## Phase 3 — real end to end

Everything above can be done now. This cannot:

1. **Apply migration 101.** Without it, device registration 500s.
2. **Upload APNs + FCM credentials to Expo** — `eas credentials`. Until both
   exist, nothing is delivered and the queue still reports `accepted`. This is
   the single most misleading failure in the chain and the main reason to do
   Phases 1 and 2 first.

   Android uses **FCM V1** (`Android` → profile → *Google Service Account* →
   *FCM V1*), not the Legacy API key. Two files come out of Firebase and only
   one is secret:

   | File | Goes | Secret |
   |---|---|---|
   | Service-account key, `<project>-<keyid>.json` | uploaded to EAS | **yes**, gitignored |
   | `google-services.json` | `packages/akiba-app/`, referenced by `android.googleServicesFile` | no, commit it |

   **Both files must come from the same Firebase project.** The canonical one
   is **`akiba-7bd7a`**, where the `com.akibamiles.akiba` Android app is
   registered. If the key and `google-services.json` disagree, the app
   registers with FCM in one project while Expo sends from the other: nothing
   arrives, and the symptom looks like an unrecognised device token rather
   than a configuration fault. `push:verify-fcm` refuses on that mismatch
   before making any network call.

   Verify the key before trusting it — a valid key on a project with the API
   switched off authenticates perfectly and then refuses every send:

   ```bash
   pnpm --filter @akiba/akiba-app push:verify-fcm ~/path/to/<project>-<keyid>.json
   ```

   It mints a real `firebase.messaging` token and probes `messages:send` with
   `validate_only`. **HTTP 400 is the success signal** (authorized, rejected
   only because the probe message is empty). A 403 `SERVICE_DISABLED` means
   the Firebase Cloud Messaging API is not enabled on the project — enable it
   at `console.developers.google.com/apis/api/fcm.googleapis.com/overview?project=<project-id>`
   and allow a few minutes to propagate. A 403 without `SERVICE_DISABLED` is
   the IAM-role case: grant *Firebase Cloud Messaging API Admin*.
3. **Set `NATIVE_PUSH_ENABLED=true`** in the target environment.
4. **Confirm Akiba-Platform actually calls
   `POST /api/internal/miles-credited`** after its award commits. That repo is
   not here, so it is unverified from this side. `push:simulate` stands in for
   it exactly — if the simulation works and a real scan does not, the gap is
   in Platform, not here.
5. Then do a real scan and watch the phone.

Verify afterwards:

```sql
select platform, status, failure_count, last_success_at
  from hub_user_devices where hub_user_id = '<uuid>';

select d.status, d.attempts, d.provider_ticket, d.last_error
  from native_push_deliveries d
  join web_push_jobs j on j.id = d.job_id
  order by d.created_at desc limit 5;
```

### iOS, before you conclude it is broken

`expo-notifications`' `mode` defaults to `development`, which sets
`aps-environment: development`. That is **correct for a development build**
and wrong for a store build — a TestFlight or App Store binary needs
`production` or it receives nothing from production APNs. It cannot be set
per EAS profile from a static `app.json`; see the store-release checklist row.

So: a dev build receiving push and TestFlight not receiving it is this, not a
code bug.

## Known gaps

- **Delivery receipts are not polled.** `provider_ticket` is stored but
  nothing reads Expo's `/push/getReceipts`, so an accepted-then-failed send
  still reads `accepted`. Until that exists, a banner on a real device is the
  only proof of delivery.
- **No in-app notification centre.** `unreadNotificationCount` is still absent
  from bootstrap and there is no `/api/v1/me/notifications`, so a missed push
  is simply missed — there is nowhere to go and see it.
