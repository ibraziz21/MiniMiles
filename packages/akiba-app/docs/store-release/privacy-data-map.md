# Privacy declaration worksheet — Akiba Pass

AKIBA-MOB-002 §10.2 and §10.3. Source-controlled so Apple's App Privacy
answers and Google Play's Data safety form are reconciled against the same
facts, and against the shipping binary — **not** copied from each other.
Google treats off-device transmission by the app *or an included SDK* as
collection, so the SDK column is not optional.

Each row must be confirmed against the binary before submission. `TBD` means
nobody has verified it yet; a `TBD` row blocks the console answer, not just
this document.

## What the binary actually does

Verified from the code in `packages/akiba-app` at the time of writing:

| Data type | Collected? | Where from | Sent off-device | Purpose | Linked to identity | Used for tracking | Required/optional |
|---|---|---|---|---|---|---|---|
| Email address | Yes | Member types it at sign-in | Yes — Supabase Auth, Akiba Hub API | Authentication (email OTP), account recovery, deletion confirmation | Yes | No | Required |
| User ID | Yes | Supabase Auth | Yes — Akiba Hub API | Authentication, scoping every member query | Yes | No | Required |
| Username | Yes | Onboarding step 2, Settings | Yes — Akiba Hub API | Identity across Akiba, leaderboards | Yes | No | Required |
| Phone number | Yes | Settings (optional field) | Yes — Akiba Hub API | Order updates, future reward matching | Yes | No | Optional |
| City | Yes | Onboarding step 2, Settings | Yes — Akiba Hub API | Ranking nearby merchants | Yes | No | Optional |
| Country | Yes | Fixed to Kenya in onboarding | Yes — Akiba Hub API | Eligibility for country-gated offers | Yes | No | Required |
| Coarse/precise location | Yes, only on request | `expo-location`, after the member taps "Near me" on Merchants | Yes — as `lat`/`lng` query parameters to `/api/v1/merchants` | Showing merchants within 25 km | No — sent with the request, not stored against the profile per current code | No | Optional |
| Wallet address | Yes | Linked outside this app (web); the app reads counts only | Yes — Akiba Hub API | Reward assignment and balance reads | Yes | No | Optional |
| Purchase / voucher history | Yes | Server-side, from merchant scans | Yes — Akiba Hub API | Miles accrual, voucher issuance and redemption | Yes | No | Required |
| Photos / user content | Yes | Discovery contributions (web today) | Yes — Supabase Storage | Merchant discovery proof | Yes | No | Optional |
| Crash data / diagnostics | **TBD** | Expo/React Native defaults | **TBD** | **TBD** | **TBD** | No | **TBD** |
| App interactions (analytics) | **No, today** | `src/analytics/track.ts` logs in development and is a no-op in production — no provider is wired up | No | n/a until a provider is chosen | n/a | No | n/a |
| Device/installation identifiers | **TBD** | `expo-device`, future push tokens | **TBD** | **TBD** | **TBD** | No | **TBD** |

### Notes that change the console answers

- **Location is ephemeral in the app's own code**: coordinates are passed as
  query parameters and never persisted client-side. Google still counts this
  as collection because it leaves the device. Confirm server-side logging
  before answering "not collected".
- **Analytics is genuinely absent**: `track()` has no provider. If one is
  added before submission, the answers above change and this row must be
  re-verified — the event names are listed in `src/analytics/events.ts`.
- **Native push is not in this build.** No device token is registered
  (`capabilities.nativePush` is hardcoded false server-side), so no push
  identifier is collected yet.
- **Gifts, Games and raffles are not in this build** — Gifts is hidden behind
  `features.gifts`, which is off by default. Do not declare data for them.

## SDK inventory — each needs its own assessment

Every third-party SDK in the binary is the developer's responsibility to
account for (§10.3). From `package.json`:

| SDK | Transmits off-device? | Notes |
|---|---|---|
| `@supabase/supabase-js` | Yes | Auth and the member's own data; the processor is Supabase |
| `expo-location` | Only when the member opts in | Coordinates to the Akiba API |
| `expo-secure-store` | No | On-device keychain/keystore only |
| `expo-web-browser` | No (opens URLs) | Legal pages |
| `expo-constants`, `expo-device` | **TBD** | Confirm no identifier is transmitted |
| `expo-image`, `expo-linear-gradient`, `expo-glass-effect`, `expo-symbols` | No | Rendering only |
| `react-native-qrcode-svg`, `react-native-svg` | No | Local rendering |
| `expo-dev-client` | n/a | Development builds only — must not be in a production artifact |

Confirm the production artifact against this table, not the dependency list:
`expo-dev-client` in particular must be absent from the store binary.

## Apple-specific

- Privacy policy URL: production `/privacy-policy`
- User Privacy Choices URL (optional): production `/account-deletion`
- Account deletion: supported in-app — Settings → Danger zone → Delete account
- Privacy manifest: inspect the generated manifest inside the archived `.ipa`
  (§15.4). **TBD** until a build exists.
- Encryption declaration: **TBD** — the app uses HTTPS and platform
  keychain/keystore only; confirm the exemption wording.

## Google-specific

- Data deletion URL: production `/account-deletion` (works without the app)
- In-app deletion path: Settings → Danger zone → Delete account
- Encryption in transit: yes — all API and Supabase traffic is HTTPS
- Account creation: yes, email OTP on first sign-in
