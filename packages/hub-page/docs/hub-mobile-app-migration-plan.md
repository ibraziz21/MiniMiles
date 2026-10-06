# Akiba Pass Mobile App Migration Plan

**Status:** Proposed implementation plan

**Snapshot date:** 4 October 2026

**Applies to:** `packages/hub-page`, a future Expo app, and their shared API contracts
**Related architecture:** [`../../../akiba-hub-architecture.md`](../../../akiba-hub-architecture.md)

## Executive decision

Build **Akiba Pass** as an Expo/React Native app against a versioned JSON API hosted by `hub-page`. Launch it in **Kenya only** and keep the existing Next.js hub live throughout the migration.

The native scope is now fixed:

- exclude Games and leaderboards entirely from the native app and mobile API;
- preserve the remainder of the current Akiba Pass experience and business rules as closely as native platform conventions allow; and
- avoid using the migration as a general product redesign. Changes should be limited to API extraction, native capability replacements, security, performance, accessibility, and store requirements.

Use this sequence:

1. Optionally ship an Android Trusted Web Activity (TWA) as a short-lived acquisition channel.
2. Build dual-auth API foundations and explicit authorization around service-role reads.
3. Expose the existing server-rendered read models as versioned, typed JSON contracts.
4. Build the Expo app screen by screen against those contracts.
5. Replace browser-only capabilities with native implementations.
6. Submit a genuinely native product to TestFlight and Google Play internal testing before public release.

Do not use a remote-URL Capacitor/WebView wrapper as the primary iOS strategy. It would preserve most web code, but it leaves the product dependent on a live website and creates a material App Review risk under Apple's minimum-functionality rule.

The existing architecture already made the stack decision: Hub Page stays Next.js and Hub App uses Expo/React Native. This document replaces the architecture's aspirational four-week schedule with a plan based on the current codebase.

## Verified current state

The current working tree contains:

- approximately 48,000 lines of TypeScript/TSX under `packages/hub-page/src`, including tests;
- 27 `page.tsx` files;
- 84 API route files, currently exporting 43 GET, 47 POST, 5 DELETE, 3 PATCH, and 1 PUT handlers;
- 96 modules under `src/lib`;
- 138 TSX files, 61 of which are client components;
- 76 test files; and
- 36 library modules that import the service-role Supabase client.

The hub already has strong mobile-web foundations:

- installable PWA metadata and shortcuts in [`../src/app/manifest.ts`](../src/app/manifest.ts);
- iOS home-screen metadata and safe-area layout in [`../src/app/layout.tsx`](../src/app/layout.tsx);
- offline page/pass caching and Web Push in [`../public/sw.js`](../public/sw.js); and
- an iOS-aware install prompt in [`../src/components/InstallPrompt.tsx`](../src/components/InstallPrompt.tsx).

The native-app blocker is the read boundary, not the visual design. Many screens call server-only libraries directly, and those libraries often use the service-role client. Native React components cannot call those functions or render Next.js server components.

Two cross-cutting blockers must be fixed before native screen work scales:

1. [`../src/lib/supabase/server.ts`](../src/lib/supabase/server.ts) and [`../src/middleware.ts`](../src/middleware.ts) authenticate with browser cookies. Native requests need Supabase access tokens sent as `Authorization: Bearer <token>`.
2. Thirteen mutation route files require a browser `Origin`: seven call `isSameOriginRequest` directly (five discovery-photo/contribution routes and two push-preference/subscription routes), while six game-session mutation routes inherit the same check through `requireGameIdentity`. Because Games are excluded from native, only the seven direct users are part of the mobile mutation-guard migration. Native requests normally have no browser origin and currently receive `403` on those routes.

Not all 84 route files need mobile auth. Fifteen are internal worker/health routes and nine are retired direct-commerce routes. The mobile contract should expose only the intentional mobile surface, leaving internal and retired endpoints isolated.

## Target architecture

```text
packages/
├── hub-page/                  Next.js web UI + API host
├── akiba-app/                 Expo Router app (iOS + Android)
│   └── src/
│       ├── api/               Typed authenticated client
│       ├── auth/              Supabase + secure session storage
│       ├── contracts/         Zod schemas, DTOs, error codes
│       └── design-system/     Native primitives and tokens
└── skill-games/               Existing web-only package; excluded from native
```

Keep the native implementation in the single `packages/akiba-app` package. Native dependencies must be installed directly in the app package for Expo Autolinking; splitting contracts, client code, or native UI into additional workspace packages adds resolution and versioning friction without a current reuse case.

### Request path

```text
Expo screen
  -> typed src/api client
  -> /api/v1/* route
  -> authenticateRequest(request)
  -> authorized domain loader/mutation
  -> Supabase/Postgres, chain RPC, or Akiba backend
  -> Zod-validated response DTO
```

The Next.js server component and the API route should call the same domain loader. Do not independently reimplement a screen's query in its route.

## API contract rules

### Authentication

Create one request-level helper, for example `src/lib/auth/requestActor.ts`:

```ts
type RequestActor = {
  userId: string;
  email: string | null;
  authMode: "cookie" | "bearer";
};

async function requireActor(request: Request): Promise<RequestActor>;
async function optionalActor(request: Request): Promise<RequestActor | null>;
```

Rules:

- If a Bearer token is present, validate it with Supabase Auth and derive the actor from the validated token.
- Otherwise, preserve the existing SSR-cookie path for web callers.
- Never accept `userId`, `hubUserId`, `canonicalId`, email, wallet ownership, or entitlement from a mobile request body.
- A Bearer token is authentication, not authorization. Every resource query must still be scoped to the derived actor.
- Internal service keys and cron secrets remain on their existing, separate authentication paths.

### CSRF and origin handling

For state-changing endpoints:

- cookie-authenticated browser request: require same-origin/CSRF protection;
- bearer-authenticated native request: do not require an `Origin`, but require a valid access token, JSON content type, rate limit, and idempotency where applicable;
- never weaken `isSameOriginRequest` globally to make mobile work;
- put this distinction in a shared mutation guard so individual routes cannot forget it.

### Authorization around service-role reads

Every service-role loader must declare its authorization mode:

- `public`: only published/public projection fields;
- `self`: rows constrained by the actor's `user_id`;
- `self_or_verified_wallet`: actor ID plus wallet addresses whose verification status is `verified`;
- `canonical_self`: canonical identity resolved server-side from the actor;
- `internal`: service-to-service only.

The route must never return raw database rows by default. Project into a DTO that contains only fields the screen needs.

### Version and force-upgrade contract

Require these headers from the native client after the first bootstrap request:

```text
Authorization: Bearer <Supabase access token>
X-Akiba-Platform: ios | android
X-Akiba-App-Version: <semantic version>
X-Akiba-Build: <integer build number>
X-Request-Id: <uuid>
```

Add `GET /api/v1/config` before the first external build. Its response should include:

```json
{
  "minimumSupportedVersion": { "ios": "1.0.0", "android": "1.0.0" },
  "latestVersion": { "ios": "1.0.0", "android": "1.0.0" },
  "maintenance": false,
  "features": {
    "walletLinking": true,
    "offlinePass": true,
    "hubQuestClaims": true,
    "akibaFundedVouchers": false,
    "quests": true,
    "discoveryContributions": true,
    "milesEarnedNotifications": true
  },
  "legal": {
    "privacyUrl": "...",
    "termsUrl": "...",
    "accountDeletionUrl": "..."
  }
}
```

Unsupported builds receive a stable `426 APP_VERSION_UNSUPPORTED` error and a store URL. Do not rely on OTA updates for native-module, permission, or binary compatibility changes.

The values above are resolved results, not raw environment configuration. The current code has global kill switches in `featureFlags.server.ts` and staged rollout evaluators for Hub quests, discovery contributions, and Miles-earned notifications that matter to native. Those evaluators combine environment flags, allowlists, and FNV percentage buckets. The separate games rollout remains web-only and must not appear in the native contract. Before exposing flags to native clients:

- centralize evaluation behind an actor-driven capability service used by web and API callers;
- use the immutable Supabase user ID as the percentage-bucketing key on both surfaces;
- treat email only as an explicit allowlist lookup during migration, never as the percentage-bucketing fallback;
- return only resolved booleans to clients, never rollout percentages, allowlists, or operator-facing disable reasons; and
- cover web/API parity and stable-cohort behavior with fixtures.

`GET /api/v1/config` is auth-optional: its anonymous response contains only globally safe values, while an authenticated response may include actor-resolved features. Mark authenticated responses `private` and key any local cache by actor. `GET /api/v1/me/bootstrap` should reuse the same capability service rather than evaluate flags independently.

### Response and error shape

Success:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "apiVersion": "v1"
  }
}
```

Error:

```json
{
  "error": {
    "code": "VOUCHER_NOT_FOUND",
    "message": "Voucher not found",
    "retryable": false,
    "requestId": "uuid"
  }
}
```

Keep error codes stable. User-facing copy belongs in the app except where the server must supply partner/customer copy.

## Screen-to-endpoint inventory

`P0` means required for the first native vertical slice, `P1` for feature-complete beta, and `P2` for parity after beta.

| Priority | Web/native surface | Current server-side reads | Proposed contract | Existing reusable route | Authorization notes |
|---|---|---|---|---|---|
| P0 | App bootstrap | Auth session, feature flags, legal/store config | `GET /api/v1/config`; `GET /api/v1/me/bootstrap` | None | `config` is auth-optional; bootstrap is self-only. Both use one actor-driven capability service and a stable user-ID rollout bucket. |
| P0 | Home `/` / For You | `resolveHubProfile`, `getHomeFeed`, `listDirectoryCities`, `getNextDiscoveryContributionRequest` | `GET /api/v1/home?lat=&lng=&intent=` | `/api/home/feed` covers only the feed | Optional actor; member-only fields must be omitted for anonymous requests. Do not persist coordinates. |
| P0 | Merchant directory `/merchants` | `listPublicMerchants`, categories, cities, voucher counts, top offers, signed-in balance | `GET /api/v1/merchants?...`; `GET /api/v1/me/merchant-state?...` | `/api/merchants` is close | Cache the public catalogue/facets; compose a small self-only affordability/saved-state overlay in the client. Preserve cursor validation. |
| P0 | Merchant detail `/merchants/[slug]` | Public merchant, balance, funded offers, claimed allocations, saved state, verified visit summary, open contribution request | `GET /api/v1/merchants/:slug`; `GET /api/v1/me/merchant-state/:slug` | `/api/merchants/[slug]` returns only the base merchant | Cache the public projection; keep saved/claimed/visit state in the self-only overlay. Never expose another user's claim state. |
| P0 | Voucher catalogue `/vouchers` | Available Miles templates, funded offers, loyalty offers, claimed allocation IDs | `GET /api/v1/vouchers`; `GET /api/v1/me/voucher-state?...` | No full read equivalent | Cache public offers separately from the self-only eligibility, progress, affordability, and claimed-state overlay. |
| P0 | Owned vouchers | Verified linked wallets plus `issued_vouchers` | `GET /api/v1/me/vouchers?status=&cursor=` | `/api/shop/vouchers/my` | `self_or_verified_wallet`. Replace raw join rows with stable voucher summaries. |
| P0 | Voucher detail `/vouchers/[id]` | Wallet ownership resolution, issued voucher, template, partner, program, immutable rules snapshot | `GET /api/v1/me/vouchers/:id` | Status and presentation routes exist, not full detail | Return `404` for both missing and not-owned resources. Never expose `user_address`, raw ownership fields, or internal rule data. |
| P0 | Pass `/pass` | `resolveHubProfile`, `getOrCreatePass` | `GET /api/v1/me/pass` | `/api/me/pass` | Self-only. Version existing handler and decide offline payload policy before launch. |
| P0 | Profile `/me` | Profile, location, canonical ID, verified wallets, balance, activity preview, saved merchants, stats, leaderboard name, verified places, voucher preview | `GET /api/v1/me/overview` | `/api/me` is legacy and incomplete | Self-only aggregate DTO. Its subqueries must all receive the same actor-derived identities. |
| P0 | Settings `/me/settings` | Profile rows, Hub profile, canonical username, linked wallets | `GET /api/v1/me/settings` | `/api/me`, `/api/me/wallets`, `/api/me/username` are partial | Self-only. Include verification state but never challenge secrets or internal identity-link details. |
| P0 | Join/login | Supabase OTP/password plus `join-complete` and wallet sync | Supabase native auth; `POST /api/v1/auth/join-complete` | `/api/auth/join-complete`, `/api/auth/sync-wallets` | Bearer required after OTP verification. Referral attribution cannot depend only on cookies. |
| P1 | Earn `/earn` | Active quest count and pending referral Miles | `GET /api/v1/earn/summary` | None | Self-only aggregate. Omit the current Games card while preserving quests, referrals, and the rest of the Earn experience. |
| P1 | Quests `/quests` | `getHubQuestStatuses`, canonical balance, rollout flag | `GET /api/v1/quests/status` | `/api/quests/status` has near parity | `canonical_self`; client cannot submit identity selectors. |
| P1 | Referrals `/referrals` | `getReferralDashboard` | `GET /api/v1/me/referrals` | `/api/referrals/me` | Self-only privacy projection; no friend email, phone, wallet, risk score, or proof reference. |
| P1 | Activity `/me/activity` | MiniPay wallet plus merged activity from engagements, mint jobs, vouchers, and ledger | `GET /api/v1/me/activity?cursor=&limit=` | None | `self_or_verified_wallet`; add cursor pagination rather than returning an unbounded merged history. |
| P1 | Notifications `/me/notifications` | User ID/email/wallet refs joined to notification outbox | `GET /api/v1/me/notifications?cursor=` | No feed endpoint | Self-only; map web paths to native deep links and filter retired commerce templates server-side. |
| P1 | Saved places `/me/saved` | `listSavedMerchants` | `GET /api/v1/me/saved-merchants` | `/api/merchants/saved` | Self-only. Preserve published/active merchant projection without deleting historical saves. |
| P1 | Welcome/onboarding | Profile, pass, `onboarding_seen_at` | `GET /api/v1/me/onboarding`; `POST /api/v1/me/onboarding/complete` | `/api/me/onboarding` only completes | Self-only. Make completion idempotent. |
| P1 | Visit card `/visit/[requestId]` | Owned request, merchant, template snapshot, prior answers/items | `GET /api/v1/me/discovery/requests/:id` | Current discovery GET is partial | Self-only by `hub_user_id`; normalize contribution and item shapes. |
| P1 | Visit entry `/visit/merchant/[slug]` | Merchant lookup plus Miles-issuance-to-request resolution | `POST /api/v1/me/discovery/requests/resolve` | None | Self-only and idempotent. Body contains merchant slug only; actor identity is server-derived. |
| P2 | Verified places/profile discovery | Public verified-discovery highlights and per-user profile statistics | Fold previews into `/me/overview`; add paged detail only if a dedicated native screen exists | None | Keep public highlights distinct from the user's verified visit history. |
| P0 | Account deletion/legal links | Static legal content plus deletion-request status | Open canonical HTTPS pages; expose authenticated deletion action | Existing privacy/terms pages; no deletion path found | Publish the deletion-request URL before native work and expose it in-app. Add raffle rules only if the binary promotes or links to raffle entry. |
| — | Redirect-only pages | `/my-vouchers`, `/me/orders` | Native route aliases only | Not applicable | Do not create APIs for redirects. Games routes receive no native alias because the feature is out of scope. |

### Recommended `GET /api/v1/me/bootstrap` response

Use one small bootstrap call after session restoration. It should not duplicate full-screen payloads.

```ts
type MobileBootstrap = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    username: string | null;
  };
  onboarding: {
    complete: boolean;
    needsWalletChoice: boolean;
  };
  capabilities: {
    quests: boolean;
    nativePush: boolean;
  };
  unreadNotificationCount: number;
};
```

### Caching and cold-start budget

Authenticated service-role reads must not enter a shared CDN cache. At the same time, a cold start that serially waits for config, bootstrap, Home, and full personalized catalogues will be too slow on variable mobile networks.

Use these boundaries:

- cache public merchant and voucher catalogue DTOs at the CDN with explicit `s-maxage`, `stale-while-revalidate`, ETags, and invalidation tied to existing catalogue revalidation events;
- serve affordability, saved, claimed, progress, and eligibility values through small `private, no-store` self-overlay endpoints;
- compose public payloads and self overlays in the API client, keyed by catalogue item ID and contract version;
- keep Home, bootstrap, Pass, balances, owned vouchers, activity, and notification data private and outside shared caches;
- persist the last successful public catalogue in the app for fast rendering, with freshness and offline-state indicators;
- cache anonymous config publicly, but mark actor-resolved config private and keep its device cache actor-scoped; and
- restore the session first, then request config, bootstrap, and Home concurrently where their contracts do not depend on one another.

Set endpoint payload-size and P50/P95 latency budgets before Phase 2. Test both warm-cache and cold-cache behavior under throttled Kenyan mobile-network profiles; instrumentation alone is not a caching strategy.

## Existing mutation routes to version and adapt

Do not rewrite working business logic merely to change its URL. Extract or retain shared handlers, add the dual-auth mutation guard, validate contracts, and expose a `/api/v1` route.

| Priority | Capability | Current routes | Versioned mobile surface | Required change |
|---|---|---|---|---|
| P0 | Profile | `PATCH /api/me`, `/api/me/username` | `PATCH /api/v1/me/profile`, `PATCH /api/v1/me/username` | Bearer auth, response schemas, consistent errors. |
| P0 | Wallets | `/api/me/wallets`, `challenge`, `verify`, `select-legacy`, `clear-minipay` | Same structure under `/api/v1/me/wallets/*` | Use WalletConnect/system-wallet signing in native; never accept an unsigned address. |
| P0 | Pass | `/api/me/pass`, `token`, `regenerate` | `/api/v1/me/pass*` | Bearer auth; define online rotating token versus offline stable fallback. |
| P0 | Merchant save | `/api/merchants/[slug]/save` | `POST`/`DELETE /api/v1/merchants/:slug/save` | Bearer auth and explicit actor/merchant constraint. |
| P0 | Voucher purchase/claim | `quote`, `redeem`, loyalty eligibility/claim, funded eligibility/claim | `/api/v1/vouchers/*` | Preserve idempotency and canonical ownership; standardize error codes. |
| P0 | Voucher presentation | `/api/shop/vouchers/[id]/presentation`, `status` | `/api/v1/me/vouchers/:id/presentation`, `/status` | Self-or-verified-wallet authorization; support app background/foreground cleanup. |
| P1 | Quests | `/api/quests/claim`, `/api/quests/proof` | `/api/v1/quests/:id/claim`, `/proof` | Bearer auth; all identity and eligibility resolved server-side. |
| P1 | Referrals | `/api/referrals/share-event` | `POST /api/v1/me/referrals/share-event` | Bearer auth; accept a bounded channel enum, not arbitrary analytics properties. |
| P1 | Discovery | Submit, withdraw, dismiss, upload-intent, photo complete/delete | `/api/v1/me/discovery/*` | Replace unconditional same-origin checks with auth-mode-aware CSRF protection; retain rate limits/idempotency. |
| P1 | Onboarding | `/api/me/onboarding` | `/api/v1/me/onboarding/complete` | Bearer auth and idempotency. |
| P1 | Native push | Web Push subscription/preference routes | `POST`/`DELETE /api/v1/me/devices`; `PATCH /api/v1/me/notification-preferences` | Add a native-token schema and sender branch; do not force Expo tokens into the Web Push schema. |
| P0 | Account deletion | None found in the current hub routes | `POST /api/v1/me/account-deletion-request` plus public web request page | Ship the public request page in Phase 0 and the authenticated API in Phase 1. Define retention, ledger, fraud, and legal-hold behavior. |

### Explicitly out of the mobile API scope

- all 15 `/api/internal/*` worker, health, reconciliation, and cron routes;
- all nine `directCommerceRetired` routes;
- all nine `/api/games/*` routes, Games screens, leaderboards, and `@akiba/skill-games` native integration;
- merchant scanner/service-key routes such as pass resolve;
- admin voucher program/grant operations unless a separate staff app is approved; and
- payment initiation. Direct commerce remains retired for the first native release.

## Native capability redesign

### Authentication and secure session persistence

- Use `@supabase/supabase-js` in Expo.
- Persist refresh/session material using a reviewed native storage adapter; do not put refresh tokens in plain AsyncStorage.
- Restore and refresh the session before calling bootstrap.
- Support deep links for OTP/magic-link flows even if the first release primarily uses a six-digit email OTP.
- Continue supporting password login only if it is needed operationally; OTP should remain the primary onboarding path.

### Push notifications

The current Web Push schema stores an endpoint plus `p256dh` and `auth` keys. Expo push tokens require a separate device model.

Add a table along these lines:

```text
hub_user_devices
- id
- hub_user_id
- installation_id
- platform: ios | android
- expo_push_token
- native_device_token (optional future direct APNs/FCM path)
- app_version
- build_number
- locale
- timezone
- status: active | revoked | invalid
- last_seen_at
- created_at
- revoked_at
```

`process-push-jobs` should dispatch through separate Web Push and native push adapters, then normalize delivery outcomes into the existing delivery/audit model.

### Offline pass

The current contracts answer the scanner-compatibility question. `GET /api/me/pass` returns a stable `akiba-pass:v1:{publicPassId}` payload that does not expire, and the service-key-authenticated scanner route resolves that stable ID until the member regenerates it. `POST /api/me/pass/token` separately mints the preferred rotating presentation token, currently documented with an approximately five-minute TTL.

Native should therefore use this explicit model:

1. Store the stable public pass ID and its rendered QR payload in encrypted/local app storage after a successful online load.
2. Store rotating presentation tokens only with their expiry.
3. Prefer a valid rotating presentation token while online.
4. When offline or token minting is unavailable, show the stable pass as a clearly labelled lower-trust fallback if security approves the replay profile.
5. If security does not approve that fallback for native, show an honest offline-unavailable state rather than a QR that cannot redeem.

No scanner change is required for the existing stable fallback. The remaining decision is a security/product approval of its replay risk and the merchant UX for distinguishing live and fallback codes.

### Wallet linking

The existing wallet challenge contract supports Celo mainnet/Alfajores (`42220`, `44787`) under the `minipay` ecosystem and Base mainnet/Sepolia (`8453`, `84532`) under `base`. MiniPay is the Celo wallet experience; this is a Celo + Base integration requirement, not an open-ended multi-chain requirement.

The browser implementation calls `window.ethereum`. Native should:

- select a WalletConnect/deep-link approach proven to sign on both Celo and Base, including a MiniPay return flow;
- receive the signature through the wallet/system-app return flow;
- send only the existing challenge ID and signature to the verification endpoint; and
- never request or embed a private key.

Wallet transaction or purchase flows should open in the wallet or system browser, not a hidden WebView.

### Referrals and deep links

Cookie referral attribution does not survive an app-store install. Introduce a signed referral-attribution token containing referral code, issued-at, expiry, and campaign/source. Support:

- installed app: universal/app link directly into the native join flow;
- not installed: store redirect plus an approved deferred-deep-link mechanism;
- post-install: redeem the signed attribution token during `join-complete`;
- one-time, idempotent attribution with server-side fraud checks.

### Discovery photos

- Use native camera/photo-library permissions with clear purpose strings.
- Strip or deliberately preserve EXIF/GPS according to the verification policy; do not let this happen accidentally.
- Resize/compress on device before requesting/uploading to the signed storage URL.
- Keep server-side content validation and photo-processing jobs authoritative.
- Preserve the current promise that location coordinates used for nearby discovery are not persisted unless the user separately submits verified evidence under an explicit policy.

### Games exclusion

Games and leaderboards remain available only on the existing web experience. The native app must not:

- expose a Games tab, card, route alias, deep link, or notification destination;
- call `GAMES_BACKEND_URL` directly or through `/api/v1`;
- depend on `@akiba/skill-games`; or
- include remaining-play counts in Earn or bootstrap.

Keep the existing web routes and code unchanged. This is a native scope exclusion, not authorization to remove Games from `hub-page`.

## Phased delivery plan

The durations below assume one senior product engineer working with AI assistance plus part-time design, QA, backend/security review, and legal/compliance support. Some phases overlap, so the calendar total is not the sum of every row.

### Phase 0 — Product and policy gates (2–4 working days)

Deliverables:

- Register the **Akiba Pass** app name and bundle IDs.
- Restrict App Store and Google Play availability to **Kenya** for the initial rollout.
- Decide whether an Android TWA is worth shipping as a temporary listing.
- Confirm that native v1 neither promotes nor links to raffle entry in the MiniPay mini-app or another sibling surface. If it does, obtain legal/store review for that promotion, its rules, and each target country.
- Record Games and leaderboards as excluded from native while leaving the existing web implementation intact.
- Record that the Hub raffle route only claims a finalized external win; do not gate the first build on unrelated CrackPot, Dice, or paid-USDT modes that are absent from `hub-page`.
- Approve a web-to-native parity checklist covering every current non-game Akiba Pass surface, route, and user journey.
- Approve or reject the existing stable Pass as a lower-trust native offline fallback.
- Select a Celo + Base wallet-link provider/return flow and a deferred deep-link provider.
- Define account deletion/retention policy.
- Publish the public account-deletion request page and canonical URL.

Exit criteria:

- Signed scope statement for native v1.
- Store configuration and release runbook target Kenya only.
- The parity checklist has no unapproved omission other than Games and leaderboards.
- A list of any cross-surface promotions hidden by remote flags until compliance is cleared.
- The public deletion-request URL is live.
- No unresolved policy question blocks the first store build.

### Phase 1 — API/auth foundation (1–2 weeks)

Deliverables:

- `packages/akiba-app/src/contracts` with versioned Zod schemas.
- `requireActor`/`optionalActor` dual-auth helper.
- Auth-mode-aware mutation/CSRF guard.
- Standard error envelope, request ID, app-version headers, and audit logging.
- `GET /api/v1/config` and `GET /api/v1/me/bootstrap`.
- Actor-driven capability evaluation with a stable user-ID cohort key across web and native.
- `POST /api/v1/me/account-deletion-request`, backed by the approved retention workflow.
- Contract-test harness for cookie/bearer parity and cross-user denial.
- First service-role loaders refactored to accept an actor rather than free-form IDs.

Exit criteria:

- The same test user gets the same bootstrap DTO using a browser cookie and a Supabase bearer token.
- Invalid, expired, and wrong-project tokens return 401.
- A valid user token cannot read a second user's fixture.
- Cookie mutations still reject cross-origin requests; native bearer mutations work without an Origin header.
- The authenticated deletion request is idempotent, auditable, and never silently removes legally retained records.

### Phase 2 — P0 read API (2–4 weeks)

Implement in this order:

1. `/home`
2. `/merchants` and `/merchants/:slug`
3. `/vouchers`, `/me/vouchers`, and `/me/vouchers/:id`
4. `/me/pass`
5. `/me/overview` and `/me/settings`

For each endpoint:

- extract/reuse the server-component loader;
- define the DTO schema;
- add cookie and bearer happy-path tests;
- add unauthenticated and cross-user tests;
- add redaction assertions for private columns;
- switch the server component to the shared loader, not an HTTP self-fetch; and
- add fixture-based parity tests for the screen's old and new data shapes.

For merchant and voucher catalogues, implement the public-cache/self-overlay split in this phase. Add cache headers, ETag behavior, invalidation tests, and a composed-client fixture proving a public payload cannot contain another member's state.

Exit criteria:

- Every P0 native screen can render from JSON without direct Supabase access to service-role tables.
- No P0 screen requires HTML parsing or a remote web page.
- P95 endpoint latency targets are measured and recorded.

### Phase 3 — Expo foundation and internal tracks (1–2 weeks, overlaps Phase 2)

Deliverables:

- Extend the existing `packages/akiba-app` Expo Router scaffold with native stacks as detail flows land.
- Keep contracts, API client, authentication, and design-system code local to `akiba-app`; verify pnpm/Metro resolution without introducing shared native workspace packages. Do not add `@akiba/skill-games` to the native dependency graph.
- Akiba native tokens, typography, icons, buttons, cards, sheets, loading/empty/error states.
- Supabase OTP auth and secure session restore.
- Typed API client with token injection, refresh, request IDs, retries, and force-upgrade handling.
- EAS development/preview/production profiles.
- Placeholder but functional builds on TestFlight and Play internal testing.
- Sentry crash reporting and PostHog/Supabase analytics decision implemented behind consent policy.

Exit criteria:

- Physical iOS and Android devices can install, sign in, restore a session, and render bootstrap.
- A killed/restarted app restores safely without leaking tokens to logs.
- Reviewers have a demo account or fully functional review path.

### Phase 4 — Native vertical slices (3–5 weeks)

Build order:

1. Home + merchant directory/detail.
2. Pass QR + offline behavior.
3. Voucher catalogue, owned vouchers, detail, presentation, and claims.
4. Profile + settings + wallet linking.
5. Earn + quests + referrals.
6. Activity, notifications, saved places, and discovery contributions.

The first public release does not need every web route. Redirect-only pages and low-volume operational surfaces stay web or are omitted until a native use case exists.

Exit criteria:

- Core journeys pass on a mid-range Android device and a supported iPhone.
- Every mutation is idempotent or has explicit retry semantics.
- App backgrounding during QR presentation, wallet linking, upload, and OTP does not corrupt state.

### Phase 5 — Native push, deep links, deletion, and compliance (2–3 weeks)

Deliverables:

- Native device-token migration and push sender branch.
- Universal links/app links and notification deep links.
- Referral install attribution.
- Native account-deletion UI wired to the Phase 1 API and the already-live public request URL.
- Camera/photo permissions and privacy disclosures.
- Store privacy/data-safety forms based on observed data flows.
- Raffle/contest rules and the required Apple non-involvement statement only if the binary promotes or links to raffle entry outside Hub.

Exit criteria:

- Push opens the correct screen from foreground, background, and terminated states.
- Revoked/invalid device tokens are retired.
- Account deletion can be initiated in-app and through the public URL.
- Legal/compliance approves the exact store binary and metadata.

### Phase 6 — Release hardening (1–2 weeks)

Deliverables:

- End-to-end tests for auth, pass, voucher claim/presentation, wallet linking, push, and deep links.
- Accessibility, low-connectivity, offline, clock-skew, and app-lifecycle testing.
- Security review of all `/api/v1` endpoints and service-role loaders.
- Load tests for home, merchant, voucher, and pass endpoints.
- Store screenshots, descriptions, privacy labels, review notes, demo credentials, and sample QR.
- Staged release plan and rollback/kill-switch runbook.

Exit criteria:

- No critical/high security findings.
- Crash-free internal-test target met.
- Backend remains compatible with the oldest supported binary.
- Store review package is complete and reproducible.

### Calendar expectation

- Android TWA, if chosen: days to roughly one week after Play setup and verification.
- Installable Expo internal shell: about 2–4 weeks after starting the API/auth foundation.
- Useful native beta with Home, Merchants, Pass, Vouchers, and Profile: about 6–10 weeks.
- Store-ready native v1 with push, deep links, deletion, compliance, and QA: about 10–16 weeks.

## Testing strategy

### Contract tests

Every `/api/v1` route must cover:

- cookie and bearer parity;
- missing, malformed, expired, and revoked tokens;
- wrong-user resource access;
- verified versus legacy-unverified wallet ownership;
- public versus authenticated response projection;
- Zod response validation;
- stable error code and status;
- idempotent retry where the route mutates state; and
- no raw service-role/database error in the response.

### Parity tests

For each migrated server component:

1. Capture a deterministic database fixture.
2. Call the shared loader as the server component does.
3. Call the `/api/v1` handler with the same actor.
4. Normalize only intentional transport differences.
5. Assert equivalent screen DTO fields.

Parity is about user-visible data, not reproducing internal database rows.

### Authorization matrix

Use at least these actors in integration tests:

- anonymous;
- User A with no wallet;
- User A with a verified wallet;
- User A with a legacy-unverified wallet;
- User B who owns the target resource;
- internal worker/service actor where applicable.

Every self-owned endpoint should include a negative test proving User A cannot read or mutate User B's fixture.

### Mobile end-to-end tests

Automate the stable journeys and keep wallet-app handoffs, OTP delivery, push delivery, and store-specific permission dialogs in a physical-device/manual matrix where automation is unreliable.

## Security and privacy release gates

1. No native app contains the Supabase service-role key, cron secret, platform service key, VAPID private key, or wallet private key.
2. No endpoint trusts a user/canonical/wallet identifier supplied by the client when it can derive it from the actor.
3. All service-role responses are DTO projections with field allowlists.
4. Ownership failures return a non-enumerating 404 where appropriate.
5. Rate limits use actor and installation/IP signals without making installation ID an authentication factor.
6. Sensitive tokens are excluded from logs, analytics, crash reports, and screenshots.
7. Location collection matches the user-facing promise and store declarations.
8. Photo EXIF/GPS handling is explicit and documented.
9. Account deletion semantics cover Supabase Auth, profiles, linked wallets, device tokens, analytics identifiers, uploaded media, and legally retained ledger/audit records.
10. The minimum-version gate exists before the first public binary.

## Store-policy gates

This is an engineering plan, not legal advice. Targeted legal review is a launch dependency for any promotion or link from the native binary to an external raffle-entry surface; unrelated chance-based products in sibling packages are not part of this Hub migration.

Current Apple guidance requires apps to offer more than a repackaged website, requires in-app account deletion when account creation is supported, and requires official raffle/contest rules in the app with a statement that Apple is not involved. Real-money gaming or lotteries require licensing, geo-restriction, and a free app. See [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/uk/).

Current Google Play policy generally disallows apps that let users wager or stake money, including money-purchased in-app items, for prizes of real-world value unless the app qualifies under the relevant licensed gambling or permitted loyalty-program rules. Google also requires an in-app deletion path and a public deletion-request URL for apps that support account creation. Apps that enable users to earn tokenized digital assets must complete the relevant financial-feature declaration and may not glamorize potential earnings. See [Real-Money Gambling, Games, and Contests](https://support.google.com/googleplay/android-developer/answer/9877032/), [account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111), and [blockchain-based content](https://support.google.com/googleplay/android-developer/answer/13607354).

The native Akiba Pass scope excludes Games entirely. Its remaining raffle-related route, `/api/vouchers/raffle`, verifies a finalized external winner and issues the winner's voucher; it does not sell, grant, or draw raffle entries. The policy question is whether the native binary promotes or links to the separate raffle-entry surface. If it does, require official rules, the Apple non-involvement statement, Kenya-specific review, and matching store declarations. If it only displays or claims an already-won voucher, document that boundary for review rather than treating unrelated paid modes as native-v1 features.

Therefore, the default native-v1 policy should be:

- do not introduce cash/USDT paid entry or staking of purchased Miles/credits into Hub;
- do not promote or link to external raffle entry until the targeted policy/legal review is complete;
- direct commerce remains retired;
- wallet signing occurs in the wallet/system flow;
- the existing claim-only raffle voucher path remains clearly separated from entry/draw mechanics; and
- store screenshots and copy emphasize merchant loyalty, Pass, vouchers, verified earning, and discovery rather than monetary winnings.

## Risk register

| Risk | Probability | Impact | Mitigation |
|---|---:|---:|---|
| Service-role query leaks another user's data | Medium | Critical | Actor-scoped loaders, DTO allowlists, cross-user tests, security review. |
| Cookie/bearer behavior diverges | Medium | High | One request-actor helper and parity tests for both auth modes. |
| Native client is blocked by same-origin checks | High without changes | High | Auth-mode-aware mutation guard; retain browser CSRF protection. |
| API contract drifts from web rendering | Medium | High | Shared loaders, contract package, fixture parity tests. |
| Stable offline Pass is replayed or mistaken for a live rotating code | Medium | High | Label it as a lower-trust fallback, retain regeneration/revocation, train scanners, or disable it if security rejects the replay profile. |
| Referral install attribution is lost | High | Medium | Signed attribution token and deferred deep-link flow before launch campaigns. |
| Push jobs support Web Push but not native devices | Certain without changes | Medium | Separate device-token table and sender adapter. |
| Wallet handoff fails after app backgrounding | Medium | High | Universal-link return handling and lifecycle tests on real devices. |
| Store rejection for web-wrapper/minimum functionality | High for wrapper | High | Native core journeys; no remote-URL wrapper as iOS product. |
| Native binary inadvertently promotes external raffle entry | Medium | High | Keep entry links absent by default; if added, require rules, Apple disclaimer, country review, declarations, and a remote kill switch. |
| Personalized catalogue prevents useful caching | High without a split | Medium | Cache public catalogue DTOs and fetch private self-state as a small overlay. |
| Existing app breaks while API is extracted | Medium | High | Shared loaders, no RSC self-fetch, existing regression suite remains green. |

## First implementation sprint

The first sprint should produce the store-blocking web deletion path and API infrastructure, not native screens:

1. Define the account-deletion/retention workflow and publish its public request page and canonical URL.
2. Extend `packages/akiba-app/src/contracts` with deletion, error, actor-safe profile, and app-version schemas alongside the scaffolded config/bootstrap contracts.
3. Add `requireActor`, `optionalActor`, and the auth-mode-aware mutation guard.
4. Add auth integration fixtures for cookie and bearer requests.
5. Implement `/api/v1/config`, `/api/v1/me/bootstrap`, and the authenticated deletion-request endpoint.
6. Centralize actor capability evaluation and pin percentage rollouts to the stable Supabase user ID.
7. Extract Home's server-side composition into a shared loader and expose `/api/v1/home`.
8. Specify the public-cache/self-overlay contracts for merchants and vouchers before implementing their reads.
9. Add cross-user/redaction tests for every service-role read touched.
10. Wire the existing `packages/akiba-app` scaffold to bootstrap and Home only after those backend contracts are stable enough to consume.

Sprint acceptance:

- an authenticated bearer-token test can load bootstrap and Home;
- the existing web Home still renders from the same underlying loader;
- anonymous Home receives no member-only values;
- location coordinates are not persisted;
- invalid app versions receive the defined upgrade response;
- the public deletion URL works without authentication, while an authenticated request is idempotent and auditable;
- the same member receives identical resolved rollout values on the web and through bearer-authenticated API calls; and
- no current web tests regress.

## AI execution support

The repository already contains `packages/hub-page/.agents/skills/vercel-react-native-skills`, which should govern Expo/RN implementation.

Before bulk endpoint work, create two repository-scoped skills:

1. `akiba-mobile-api-contract` — dual auth, actor types, DTO/error conventions, service-role authorization checklist, versioning, and required tests.
2. `akiba-native-port-rules` — no DOM primitives, native navigation/safe areas, list virtualization, storage/lifecycle rules, design tokens, and accessibility expectations for `packages/akiba-app`.

A third parity-test generator can be added after the first two endpoint migrations establish the pattern. It should generate a test skeleton, never infer authorization rules without review.

## Locked product decisions

1. The native product name is **Akiba Pass**.
2. The initial App Store and Google Play rollout is **Kenya only**.
3. Games and leaderboards are excluded from native; the existing web implementation remains unchanged.
4. Every other current Akiba Pass capability remains in scope, subject only to native-platform, security, performance, accessibility, and store-compliance adaptations.

## Decisions still required from the team

1. Is an Android TWA worth operating while the native app is built?
2. Will the native app promote or link to raffle entry in the MiniPay mini-app or another sibling surface? The Hub's own route is claim-only.
3. Does security approve the already-supported stable Pass as a lower-trust offline fallback, and how should scanners distinguish it from a live rotating code?
4. Which WalletConnect/deep-link integration will reliably sign and return on the required Celo and Base chains, including MiniPay on Celo?
5. Which deferred deep-link provider and attribution retention window will referrals use?
6. Which records must be retained after account deletion, and for how long?
7. Will native push use Expo Push initially, or direct FCM/APNs from day one?
8. Who owns final security and legal sign-off for `/api/v1` and store submission?

Once those decisions are recorded, this document is sufficient to turn the migration into epics and endpoint-level tickets.
