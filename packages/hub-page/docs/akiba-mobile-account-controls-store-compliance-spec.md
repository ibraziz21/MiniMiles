# AKIBA-MOB-002: Account Controls and Store Compliance

- **Packages:** `packages/akiba-app`, `packages/hub-page`, `packages/website`,
  `supabase/migrations`
- **Status:** Proposed
- **Priority:** P0 launch blocker
- **Depends on:** `AKIBA-MOB-001` (bootstrap, config gate, onboarding, OTP)
- **Target:** Kenya-only iOS and Android launch
- **Last reviewed:** 2026-10-10

---

## 0. Release decision

Akiba Pass must not be submitted to App Store Review or Google Play production
until every P0 acceptance criterion in this spec passes against a store-signed
build and the production Hub deployment.

This spec closes two launch blockers:

1. a member can initiate full account deletion in the app and from a public
   web page, with clear treatment of profile, reward, voucher, ledger, fraud,
   and on-chain data; and
2. the native binary has reproducible store identities, environments, assets,
   legal metadata, privacy declarations, and build profiles.

Apple requires an easy-to-find in-app path for deleting the full account when
an app supports account creation. Reauthentication and confirmation are
allowed, but unnecessary friction or a support-only flow is not. Google Play
requires both an in-app deletion path and a functional public web resource for
account deletion. See [Apple's account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
and [Google Play's account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

This is an engineering and product specification, not legal advice. The data
retention schedule and member-facing wording require approval by Akiba's legal
or data-protection owner before production processing is enabled.

## 1. Current baseline

`AKIBA-MOB-001` already provides:

- authenticated `/api/v1/config` and `/api/v1/me/bootstrap` cold-start gates;
- config-driven privacy, terms, account-deletion, and store URL contracts;
- email OTP entry and resend primitives;
- authenticated Settings and sign-out surfaces; and
- dual-auth, auth-mode-aware mutation guards in `packages/hub-page`.

MOB-002 does not replace those foundations. It completes the missing surfaces
and makes the release configuration real.

Known gaps at the start of this spec:

- `legal.accountDeletionUrl` resolves to `/account-deletion`, but that page
  does not exist;
- Settings has no account-deletion entry or flow;
- no deletion-request API, durable workflow, data inventory, or retention
  schedule exists;
- `com.akiba.pass` is explicitly marked as a placeholder for both platforms;
- there is no `eas.json` or bound EAS project identity;
- the current app icon and adaptive foreground are 512×512, while Expo
  recommends a 1024×1024 source;
- the bundled FT Sterling files are named `Trial` and cannot ship without
  production licensing evidence; and
- the app declares automatic light/dark appearance while its tokens implement
  a light theme only.

## 2. Goals

1. Give every signed-in member a clear Settings path to request deletion of
   their entire Akiba account and associated personal data.
2. Verify the request using a one-time code sent to the account's confirmed
   email before accepting the destructive action.
3. Make request submission self-only, idempotent, race-safe, auditable, and
   safe across native Bearer and web cookie authentication.
4. Delete or anonymize personal data while preserving only records covered by
   an approved legal, fraud, settlement, accounting, or evidence purpose.
5. Explain immutable Celo/on-chain records and retained pseudonymous records
   before confirmation; neither may be presented as deleted.
6. Publish a public, store-listing-safe account deletion page that uses the
   same backend workflow as the app.
7. Replace placeholder distribution settings with reproducible development,
   preview, and production builds.
8. Produce the privacy, data-safety, legal, asset, metadata, and device-test
   evidence required for store submission.
9. Add the first device-driving Maestro harness and cover the unverified
   MOB-001 onboarding flow plus the MOB-002 account-control flow.

## 3. Non-goals

- Pass rotation, screenshot resistance, and offline Pass behavior
  (`AKIBA-MOB-003`).
- App-wide color, typography, Dynamic Type, or dark-theme remediation
  (`AKIBA-MOB-004`), except where a MOB-002 screen would otherwise be
  inaccessible.
- Native push, referrals, discovery contributions, Gifts, raffles, or Games.
- Building a general privacy portal for data export or correction.
- Synchronous deletion inside the request API.
- Enabling EAS Update or another over-the-air update system for v1.
- Inventing retention periods in application code without an approved policy.

## 4. Locked product decisions

1. The Settings label is **Delete account**, not *Deactivate account*.
2. The normal flow completes without requiring a phone call, support email, or
   explanation from the member.
3. The flow uses a full screen, not a one-tap alert. The final action is
   protected by email verification and one explicit acknowledgement checkbox.
   Do not require typing `DELETE`; that adds effort without stronger identity
   proof.
4. The deletion option lives in a separate **Danger zone** below sign out. It
   is visually separated from routine profile settings.
5. Submission is asynchronous. The app promises a maximum processing target
   of **14 calendar days**, unless an approved legal hold applies. Legal must
   approve this SLA before launch.
6. There is no self-service cancellation after final confirmation in v1. The
   pre-confirmation screen provides a safe Back action. Support may resolve an
   exceptional request only while its status is still `requested`.
7. Requesting deletion never burns, transfers, or rewrites blockchain assets.
   Public on-chain wallet addresses and token transactions are immutable and
   remain visible on Celo. Akiba removes its off-chain account association
   where the approved retention plan allows it.
8. Active Pass credentials and unredeemed account-bound vouchers are disabled
   during processing. The confirmation screen must show the member's current
   Miles balance and active voucher count and state that access will be lost.
   Deletion cannot be blocked merely because a balance or voucher exists.
9. The first store release supports iOS and Android only. Expo web export is
   not a release target for `packages/akiba-app`.
10. The v1 binary is light-theme only. Set the native appearance to `light`
    until a complete dark token set is delivered in MOB-004.
11. v1 releases go through the stores. EAS Update remains disabled until a
    separate update, rollback, and code-signing policy is approved.

## 5. Member experience

### 5.1 Settings entry

Add a final section to `src/app/(tabs)/profile/settings.tsx`:

```text
Danger zone
Delete account
Permanently delete your Akiba account and personal data
```

Requirements:

- use the existing danger color and a trash icon from the current icon set;
- use a real button/pressable with a 44×44 point minimum target;
- expose an accessibility label and hint;
- do not communicate destructiveness by color alone; and
- navigate to `/profile/delete-account`; never submit from the row itself.

### 5.2 Deletion information screen

Create `src/app/(tabs)/profile/delete-account.tsx`. It must display, in this
order:

1. **What will be deleted** — sign-in account, profile/contact data, Akiba
   Pass, saved places, notification registrations, linked-wallet association,
   unpublished contributions, and user-uploaded photos where no approved
   exception applies.
2. **What happens to rewards** — show current Miles balance and active voucher
   count; state that account-bound access and active Pass credentials will be
   removed and unredeemed vouchers will become unusable.
3. **What may remain** — pseudonymized transaction, voucher-redemption,
   settlement, fraud, security, and audit records when an approved purpose
   requires retention.
4. **What cannot be erased by Akiba** — public blockchain transactions and
   wallet addresses already written to Celo.
5. **Timing** — processing target and completion email behavior.
6. A secondary **Keep my account** action and a primary danger **Continue**
   action.

The page must load a fresh self-only deletion summary. Never trust balance or
voucher counts passed through navigation parameters.

### 5.3 Verify ownership

On Continue:

1. call the challenge endpoint;
2. show the already confirmed account email in masked form;
3. reuse the MOB-001 six-digit input, paste normalization, autofill, mapped
   errors, and deadline-based resend behavior;
4. use account-deletion-specific copy so the code is not mistaken for a normal
   sign-in; and
5. keep the user on this flow after app background/foreground transitions.

The code request must set Supabase `shouldCreateUser: false`. A deletion flow
must never create an account for an unknown address. Supabase OTP send and
verification rate limits remain in force, and Akiba adds a per-user deletion
challenge limit. See [Supabase passwordless email guidance](https://supabase.com/docs/guides/auth/auth-email-passwordless)
and [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### 5.4 Final confirmation

After successful code verification, show a final review with:

- the deletion effects summary;
- an unchecked acknowledgement: **I understand that I will lose access to my
  Akiba Pass, active vouchers, and account-based rewards.**;
- a danger button: **Delete my Akiba account**; and
- a non-destructive **Back** action.

The destructive button remains disabled until acknowledgement. While the
request is in flight, prevent duplicate taps and show visible progress.

### 5.5 Success and session handling

For an accepted request:

1. render a receipt containing the opaque request reference and processing
   target;
2. clear the local Supabase session and SecureStore material;
3. reset authenticated navigation state;
4. retain only the non-sensitive receipt reference in memory for the success
   screen; and
5. explain that a confirmation was sent to the account email.

If another device uses an existing session after the request, authenticated
v1 routes return `ACCOUNT_DELETION_PENDING`. The app must clear that session
and show a neutral message that the account deletion request is being
processed.

### 5.6 Error states

| Condition | Member-facing behavior |
|---|---|
| Offline before challenge | Keep the page and offer Retry |
| OTP rate limited | Show the server-provided retry time; do not loop sends |
| Wrong/expired OTP | Keep the entered context and allow a bounded retry |
| Dropped response after final submit | Retry safely; return the original request reference |
| Already requested | Treat as success and return the original request reference |
| Processing/legal hold | Explain the status without exposing internal fraud or legal details |
| Auth expired | Sign out and ask the member to sign in again |
| Service unavailable | Preserve the flow state and offer Retry; never imply deletion succeeded |

## 6. Public account-deletion page

Add `packages/hub-page/src/app/account-deletion/page.tsx` and the necessary
client component(s). The route must be public, indexable, and usable on a
small phone without installing the app.

Above the fold it must say:

- **Delete your Akiba Pass account**;
- **Akiba Ecosystems Ltd** as the developer/operator;
- what account and data the request covers; and
- a primary **Start deletion request** action.

The page then explains deletion, retention, blockchain limits, the processing
target, and the support fallback. If signed out, the primary action starts the
existing web OTP login and returns to `/account-deletion`. Once authenticated,
the page uses the same challenge and request APIs as native.

The default path must not be `mailto:`. Support is a fallback for a member who
has lost access to their confirmed email, not the normal deletion mechanism.

Production requirements:

- `GET /account-deletion` returns 200 without authentication;
- the canonical production HTTPS URL is returned by `/api/v1/config`;
- the URL is entered in Google Play's account deletion field and may also be
  used as Apple's User Privacy Choices URL;
- automated link checks cover privacy, terms, account deletion, and support;
  and
- the page remains available during native maintenance mode.

Google states that the web resource must work, prominently expose the deletion
path, and reference the app or developer name shown in the listing. See the
[Google Play deletion policy](https://support.google.com/googleplay/android-developer/answer/13327111).

## 7. API contracts

All responses use the existing `{ data, meta }` / structured error envelope,
`Cache-Control: private, no-store`, and `X-Request-Id` behavior.

Extend `/api/v1/config` and the native config schema with the server-owned
deletion copy version:

```ts
legal: {
  privacyUrl: string;
  termsUrl: string;
  accountDeletionUrl: string;
  deletionPolicyVersion: string;
}
```

The app sends this value as `policyVersion` after showing the corresponding
copy. The request API accepts only the currently active version; it never
trusts an arbitrary client-supplied policy label. Deploy the Hub contract
before the consuming app build.

### 7.1 `GET /api/v1/me/account-deletion-summary`

Authentication: required, self-only.

Response:

```ts
type AccountDeletionSummary = {
  maskedEmail: string;
  milesBalance: number;
  activeVoucherCount: number;
  linkedWalletCount: number;
  processingTargetDays: 14;
  onChainRecordsRemain: true;
};
```

This endpoint is a fresh server projection. It returns counts only and never
wallet addresses, voucher codes, internal risk state, or raw ledger records.

### 7.2 `POST /api/v1/me/account-deletion/challenge`

Authentication: required. Apply `assertMutationAllowed`, the shared rate-limit
primitive, and the Supabase/Auth provider limit.

Request body:

```json
{}
```

Response:

```ts
type AccountDeletionChallenge = {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
  resendAvailableAt: string;
};
```

Rules:

- resolve the email from the authenticated actor; never accept it in the body;
- set `shouldCreateUser: false` when requesting the OTP;
- store only an opaque challenge ID, actor ID, expiry, attempt count, and
  purpose; do not store the OTP;
- expire after ten minutes and allow at most five verification attempts;
- allow at most one live challenge per user; and
- return generic delivery language so the route does not become an email
  enumeration surface.

### 7.3 `POST /api/v1/me/account-deletion-request`

Authentication: required, including for an actor whose first request already
created a pending deletion row. Apply the mutation guard.

Request:

```ts
type AccountDeletionRequestInput = {
  challengeId: string;
  otp: string;
  acknowledgement: true;
  policyVersion: string;
};
```

Response: HTTP `202` for a new or existing request.

```ts
type AccountDeletionReceipt = {
  requestId: string;
  status: "requested" | "processing" | "legal_hold" | "completed";
  requestedAt: string;
  targetCompletionAt: string;
  alreadyRequested: boolean;
};
```

Server sequence:

1. resolve the current actor;
2. look up an existing non-cancelled request for that actor and, if present,
   return its original receipt immediately without reusing the consumed OTP;
3. resolve the actor's live challenge;
4. verify the email OTP with Supabase;
5. require the verified Supabase user ID to equal `actor.userId`;
6. discard and revoke the server-created verification session;
7. compare `policyVersion` with the server's current deletion policy version;
8. atomically consume the challenge and insert or return the deletion request;
9. append an audit event without email, token, OTP, wallet, or IP address;
10. return the durable receipt; and
11. enqueue processing after the response transaction commits.

Idempotency is **first request wins**. Concurrent or repeated submissions for
one user return the original `requestId`, `requestedAt`, and target date. A
retry after an unknown response does not require a second code. The OTP and
challenge are never logged.

### 7.4 Pending-account guard

Extend the authenticated actor boundary so all protected `/api/v1` routes,
except deletion retry/receipt handling, reject an actor with an active request:

```json
{
  "error": {
    "code": "ACCOUNT_DELETION_PENDING",
    "message": "This account has a deletion request in progress"
  }
}
```

Use HTTP `410 Gone`. Implement the error as a subclass compatible with the
existing `UnauthorizedError` catch paths so routes do not silently turn it into
a 500. The deletion endpoint uses an explicit
`requireActorAllowingDeletionPending` path so a lost-response retry remains
idempotent.

## 8. Persistence and processing

Use the next available forward-only Supabase migration. Do not edit an applied
migration.

### 8.1 Tables

```text
account_deletion_challenges
  id                    uuid primary key
  hub_user_id           uuid not null references auth.users(id)
  purpose               text not null check (purpose = 'account_deletion')
  expires_at            timestamptz not null
  attempt_count         integer not null default 0
  consumed_at           timestamptz null
  created_at            timestamptz not null

account_deletion_requests
  id                    uuid primary key
  hub_user_id           uuid not null references auth.users(id)
  status                text not null
  source                text not null
  policy_version        text not null
  completion_contact_ciphertext bytea null
  completion_contact_key_version text null
  requested_at          timestamptz not null
  target_completion_at  timestamptz not null
  processing_started_at timestamptz null
  completed_at          timestamptz null
  completion_email_sent_at timestamptz null
  hold_reason_code      text null
  failure_code          text null
  updated_at            timestamptz not null

account_deletion_events
  id                    uuid primary key
  request_id            uuid not null references account_deletion_requests(id)
  event_type            text not null
  actor_kind            text not null
  metadata              jsonb not null default '{}'
  created_at            timestamptz not null
```

Allowed request states:

```text
requested -> processing -> completed
requested -> legal_hold -> processing -> completed
requested -> failed -> processing
```

`cancelled` is an admin-only exceptional state and is not exposed as a normal
member action. A partial unique index permits only one non-cancelled request
per `hub_user_id`. `source` is constrained to `native_ios`, `native_android`,
or `web`. Active/pending means `requested`, `processing`, `legal_hold`, or
`failed` until an operator completes or exceptionally cancels the request.

Security requirements:

- enable RLS and revoke anon/authenticated table access;
- service-role access only;
- create the request through a transaction/RPC that takes an advisory lock on
  the user;
- use constrained status transitions rather than arbitrary updates;
- do not store plaintext email, phone, wallet address, OTP, access token,
  free-text legal notes, or raw IP address in these tables;
- the encrypted completion contact is purpose-limited, key-versioned,
  unreadable to support roles, and purged immediately after successful
  delivery or at the approved delivery-expiry limit; and
- keep member-visible request IDs opaque and unguessable.

### 8.2 Processing worker

The worker may be triggered by a protected internal route or scheduled job,
but it must use the repository's existing authenticated internal-job pattern.
It is at-least-once and every step is idempotent.

Processing order:

1. claim one request with a lease and append `processing_started`;
2. block normal v1 account access through the pending-account guard;
3. enumerate and delete user-owned Storage objects before Auth deletion;
4. delete direct profile, contact, preference, device, save, challenge, and
   unpublished-content data;
5. delete public user-generated content unless the approved policy identifies
   a specific lawful retention purpose;
6. revoke/void active Pass presentation material and unredeemed account-bound
   vouchers without erasing voucher/redemption audit history;
7. unlink off-chain wallet associations without attempting to mutate Celo;
8. pseudonymize required transaction, reward, settlement, fraud, risk, and
   audit records according to the approved retention map;
9. remove or anonymize identifiers held by analytics, email, support, and other
   processors and record the processor result, not the PII;
10. load the completion address into worker memory from the encrypted,
    purpose-limited contact field;
11. soft-delete the Supabase Auth user from a server-only service-role context;
12. mark the request complete;
13. enqueue/send the completion email, retrying independently if delivery
    fails; and
14. purge the encrypted contact and key version after successful delivery or
    the approved delivery-expiry limit.

Supabase documents that Auth deletion must run server-side with the service
role, that Storage ownership can block deletion, and that already issued JWTs
remain usable until expiry unless sensitive routes also validate session
state. The pending-account guard is therefore required, not optional. See
[Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
and [server-side user deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

### 8.3 Retry and failure behavior

- Each processing step stores a stable completion marker or derives completion
  safely from current state.
- A failure records a bounded code and retry count, never a raw provider body
  that may contain PII.
- Retries use exponential backoff and a dead-letter/alert threshold.
- `completed` is terminal.
- A request that misses `target_completion_at` pages the on-call owner and
  appears in an admin reconciliation queue.
- Backups follow the approved retention schedule; data may age out through the
  normal backup cycle only if this is disclosed and legally approved.

## 9. Data inventory and retention contract

Before enabling the worker, engineering and the data-protection owner must
approve a versioned row-by-row inventory. Kenya's Data Protection Act provides
for erasure of data no longer authorized or necessary to retain, while its
General Regulations require a retention schedule with purpose, period,
periodic audit, and end-of-period action. See the
[Kenya Data Protection Act](https://new.kenyalaw.org/akn/ke/act/2019/24/eng@2019-11-15/source)
and [Data Protection (General) Regulations](https://new.kenyalaw.org/akn/ke/act/ln/2021/263/eng@2022-01-14/source).

The inventory must include every table, Storage bucket, external processor,
and public chain touched by an Akiba account. The initial minimum classification
is:

| Data class | Required action | Notes |
|---|---|---|
| Supabase Auth identity and sessions | Soft-delete/revoke | Server-only after dependent cleanup |
| Email, phone, name, username, city, avatar | Delete | Includes duplicated profile projections |
| Pass and presentation secrets | Delete/revoke | No valid credential remains |
| Saved merchants and preferences | Delete | No retention purpose |
| Push/device registrations | Delete | Includes future native tokens |
| Linked-wallet relationship | Delete | Do not alter the external wallet or chain |
| Unpublished discovery answers/photos | Delete | Include Storage objects and processing jobs |
| Published member photos/content | Delete by default | Exception requires approved purpose and disclosure |
| Active account-bound vouchers | Void and pseudonymize | Preserve required issuance/redemption audit only |
| Miles/reward ledger | Pseudonymize/retain if approved | Remove direct contact/profile linkage |
| Voucher redemption, settlement, payment evidence | Pseudonymize/retain if approved | Period and lawful purpose must be named |
| Fraud, abuse, risk, and security audit | Pseudonymize/retain if approved | Restrict processing and access |
| Referral relationships | Delete or pseudonymize | Do not expose the deleted member to either party |
| Notification history | Delete unless transaction evidence is required | Never retain delivery addresses unnecessarily |
| Analytics/crash data | Delete or anonymize | Include third-party SDK processor identifiers |
| Celo transactions and wallet addresses | Cannot be deleted by Akiba | Explain before confirmation and in policy |
| Deletion request/events | Retain pseudonymously | Evidence of request and completion only |

For every retained class, the approved inventory must name:

- purpose and lawful basis;
- exact retention period;
- fields retained;
- pseudonymization method;
- people/roles allowed to access it;
- processor and storage region;
- periodic review cadence; and
- final deletion/anonymization action.

No production feature flag may enable deletion processing while an inventory
row is `TBD`.

## 10. Legal content and privacy declarations

### 10.1 Canonical pages

Update the mirrored legal content in both `packages/hub-page` and
`packages/website` in one change. The privacy policy must:

- identify the Akiba Pass mobile app;
- link directly to `/account-deletion` instead of offering only an email path;
- distinguish deletion from legal retention and restricted processing;
- disclose Celo/on-chain immutability in the deletion section;
- describe location use, including whether coordinates are ephemeral;
- list current processors and cross-border handling accurately; and
- state the policy version used in deletion acknowledgement.

The terms must explain the deletion effect on Pass access, unredeemed vouchers,
and account-based rewards. Privacy, terms, and deletion pages must use the same
company name and support address as both store listings.

### 10.2 Apple privacy

Create a source-controlled declaration worksheet and reconcile it against the
shipping binary, backend flows, and every bundled SDK. At minimum assess:

- email address, phone number, name/username, and user ID;
- city and precise/approximate location;
- wallet address and reward/transaction history;
- purchase or voucher history;
- photos and other user-generated content;
- app interactions, diagnostics, and crash logs; and
- device or installation identifiers.

App Store Connect requires a privacy policy URL and accurate disclosures for
the app and third-party partners. The account-deletion page can be supplied as
the optional User Privacy Choices URL. See [Apple's App Privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/)
and [privacy manifest guidance](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk).

### 10.3 Google Play Data safety

Complete the same inventory in Play Console rather than copying Apple answers
blindly. Google treats off-device transmission by the app or an included SDK
as collection, including ephemeral location processing, and requires the
developer to account for third-party SDK behavior. See
[Google Play Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469).

The final form must declare:

- whether each data type is collected, shared, required, or optional;
- the processing purpose;
- encryption in transit;
- deletion-request availability; and
- the production `/account-deletion` URL.

## 11. Native distribution foundation

### 11.1 Immutable app identity

Before the first external build:

- reserve and approve the final iOS bundle identifier and Android package
  name;
- replace `com.akiba.pass` in app config;
- remove `bundleIdentifiersArePlaceholders` notes;
- bind the Expo `owner` and EAS `projectId` to the organization account;
- create App Store Connect and Play Console app records with the same **Akiba
  Pass** display name; and
- record the Apple team, Google developer account, and credential owners in
  the private operations runbook, not in the repository.

Bundle/package identifiers are immutable after store publication. The approved
values must therefore be product decisions, not generated during implementation.

### 11.2 EAS profiles

Add `packages/akiba-app/eas.json` with:

- `development`: development client, internal distribution, development EAS
  environment;
- `preview`: internal distribution, preview EAS environment;
- `production`: store distribution, production EAS environment, remote app
  version source, and automatic build-number/version-code increment; and
- `submit.production`: App Store Connect and Play app bindings without secrets
  committed to Git.

Require a clean Git commit for production builds. Install `expo-dev-client`
through `npx expo install` if the development profile uses it. Expo defines
build profiles in `eas.json` and recommends separate development, preview, and
production environments. See [EAS build configuration](https://docs.expo.dev/build/eas-json/)
and [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

### 11.3 Environment contract

Create development, preview, and production EAS values for:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_API_BASE_URL
```

Rules:

- production API and Supabase URLs use HTTPS and point only to production;
- preview never points to production mutation endpoints;
- every `EXPO_PUBLIC_` value is treated as public information;
- no service-role, SMTP, signing, Platform service, wallet, or store credential
  is bundled into the app;
- dynamic app config fails the build when required production values are
  absent; and
- CI prints variable names and environment selection, never values.

### 11.4 Versioning and updates

- `expo.version` is the member-visible release version.
- EAS remote versioning owns `ios.buildNumber` and `android.versionCode` and
  increments them for production builds.
- `/api/v1/config` minimum/latest version checks remain semantic app-version
  checks, not build-number checks.
- Store URLs remain nullable until listings exist, then become required in the
  production Hub environment before setting a higher minimum version.
- Set `updates.enabled` to `false` for v1. Do not add an update URL or runtime
  policy in this spec.

Expo distinguishes the store-visible app version from platform build versions;
see [Expo app version management](https://docs.expo.dev/build-reference/app-versions/).

### 11.5 Assets, fonts, and appearance

- Replace the top-level icon with a reviewed 1024×1024 PNG source.
- Provide Android adaptive foreground and monochrome layers and validate common
  masks.
- Validate splash rendering from preview/production builds, not Expo Go.
- Store source artwork outside generated native folders; Expo remains managed
  and no manual `ios/` or `android/` project is committed.
- Remove all `FTSterlingTrial-*` files. Either add licensed production files
  with procurement evidence outside Git or replace the family and update every
  token reference.
- Set `userInterfaceStyle` to `light` for v1.
- Set explicit supported platforms to iOS and Android and remove web output
  from the release contract.
- Confirm the encryption declaration and inspect the generated iOS privacy
  manifest in the archived `.ipa`.

Expo recommends a 1024×1024 app icon source and preview/production builds for
reliable splash testing. See the [Expo SDK 57 app config](https://docs.expo.dev/versions/v57.0.0/config/app/)
and [splash/icon guidance](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/).

## 12. Store listing package

Create a version-controlled release checklist and metadata source containing:

- app name, subtitle/short description, full description, keywords, and
  category;
- privacy, terms, account deletion, support, and marketing URLs;
- support email owned by the organization;
- Kenya-only availability for the first rollout;
- age rating/target audience consistent with the Terms' 18+ requirement;
- screenshots from small and large supported phones on both platforms;
- final icon, feature graphic, and promotional copy;
- App Review / Play review notes that explain OTP login, location, Pass QR,
  Miles, voucher redemption, and the absence of cash-out;
- a durable review account or review-safe OTP procedure;
- test instructions for any location-dependent merchant content;
- export compliance, content-rights, advertising, and financial-feature
  declarations; and
- named owner and date for every console answer.

Do not mention Gifts, Games, raffles, push, or any feature hidden by the
production capability response. Store screenshots and copy must match the
reviewed binary.

## 13. Accessibility and interaction requirements

The MOB-002 flow must:

- use descriptive visible labels and accessibility labels for all controls;
- expose headings, errors, progress, checkbox state, and disabled state to
  VoiceOver and TalkBack;
- move focus to the OTP error or confirmation heading when the step changes;
- never rely on red alone to convey the destructive action;
- maintain at least 4.5:1 contrast for normal text;
- support text scaling without clipping the deletion consequences or actions;
- keep the safe Back/Keep action available before final submission;
- prevent double submission while preserving retry after an unknown response;
  and
- announce accepted deletion and the request reference.

The full app color remediation remains MOB-004. The MOB-002 screens must use
the accessible `tealDark` button treatment introduced in MOB-001, not the
failing white-on-`colors.teal` combination.

## 14. Analytics, logging, and support

Allowed product events:

```text
account_deletion_opened
account_deletion_challenge_requested
account_deletion_verification_failed
account_deletion_confirmed
account_deletion_request_accepted
account_deletion_request_failed
```

Event properties are limited to platform, app version, flow step, bounded
error code, and `already_requested`. Never include email, phone, user ID,
request ID, OTP, wallet address, voucher ID, balance, or free text.

Operational metrics:

- requests by status and age;
- challenge/send/verify error rates;
- processing duration and retry count;
- missed target count;
- processor cleanup failures; and
- completion-email failures.

Support tooling may search by the request reference supplied by the member. It
must not expose internal fraud evidence or retained transaction records to
general support roles.

## 15. Testing strategy

### 15.1 Backend tests

Add route, domain, and database tests for:

- Bearer and cookie authentication;
- wrong-project, expired, and malformed tokens;
- mutation guard behavior for both auth modes;
- challenge expiry, attempt exhaustion, resend limit, and single-live
  challenge behavior;
- OTP user ID mismatch and `shouldCreateUser: false` behavior;
- acknowledgement and policy-version validation;
- first-write-wins idempotency under concurrent requests;
- cross-user access rejection;
- pending-account rejection across representative private read and mutation
  routes;
- retry after a dropped response;
- state transition constraints and worker leases;
- every delete/anonymize/retain inventory rule;
- Storage cleanup before Auth deletion;
- partial worker failure and replay;
- PII absence from logs, event metadata, and structured errors; and
- public page/config URL parity.

### 15.2 App unit tests

Cover:

- summary schema and deletion contracts;
- step resolution after background/foreground and route remount;
- OTP paste normalization and deadline-based resend behavior in deletion mode;
- confirmation disabled until acknowledgement;
- mapped challenge, verification, pending, and retryable errors;
- duplicate-submit prevention;
- session clearing only after an accepted/existing receipt; and
- stale-device handling for `ACCOUNT_DELETION_PENDING`.

### 15.3 Maestro E2E

Add a minimal Maestro harness in this spec. Required flows:

```text
first-run-onboarding.yaml
returning-member-cold-start.yaml
legal-links.yaml
account-deletion-cancel.yaml
account-deletion-invalid-code.yaml
account-deletion-submit.yaml
account-deletion-lost-response-retry.yaml
```

The submit flow uses a disposable seeded account and a non-production email/OTP
harness. It must assert backend receipt creation and local sign-out. It must
never point at production.

### 15.4 Build and store artifact verification

From a clean checkout:

```bash
pnpm --filter @akiba/akiba-app lint
pnpm --filter @akiba/akiba-app typecheck
pnpm --filter @akiba/akiba-app test
pnpm --filter @akibamiles/hub-page test
pnpm --filter @akibamiles/hub-page build
pnpm --dir packages/akiba-app dlx expo-doctor@latest
pnpm --filter @akiba/akiba-app exec expo export --platform ios
pnpm --filter @akiba/akiba-app exec expo export --platform android
```

Also require successful EAS preview and production builds for both platforms.
Inspect the signed artifacts for:

- final bundle/package ID, version, build number, and display name;
- no trial font files;
- expected permissions only;
- 1024×1024 icon source and adaptive layers;
- iOS privacy manifest validity;
- production API/Supabase project selection; and
- absence of server secrets.

### 15.5 Physical-device matrix

Run on at least:

- one current physical iPhone;
- one older supported physical iPhone;
- one mid-range physical Android device; and
- one Android device/API level matching the declared minimum.

Verify cold start, OTP autofill/paste, background recovery, legal links,
location denial, account-deletion cancellation, final submission, stale second
device behavior, VoiceOver/TalkBack, large text, slow network, and offline
retry.

## 16. Rollout order

1. Approve the data inventory, retention schedule, member copy, bundle IDs,
   developer accounts, and font decision.
2. Ship canonical privacy/terms updates and the public `/account-deletion`
   information page with deletion submission disabled.
3. Deploy the migration, challenge/request APIs, pending-account guard, worker,
   reconciliation view, and alerts.
4. Exercise deletion end to end in a non-production Supabase project using
   disposable accounts containing every data class.
5. Enable the production web submission path and verify its store URL.
6. Ship the native Settings/deletion flow in an EAS preview build.
7. Complete Maestro and physical-device verification.
8. Create the store records, final assets, privacy declarations, and review
   metadata.
9. Build the production binaries from a clean commit.
10. Deploy `packages/hub-page` before distributing the binary.
11. Submit to internal/TestFlight tracks, then store review, then a Kenya-only
    staged rollout.

Account deletion is mandatory functionality, not a member rollout experiment.
The processor worker may have an operator kill switch for incident response,
but accepted requests must remain durable, visible to operators, and completed
within the approved target after recovery.

## 17. Acceptance criteria

### P0 — account deletion

- [ ] A signed-in member can find **Delete account** from Settings in at most
  two taps.
- [ ] The app shows exact effects on profile, Pass, Miles, vouchers, retained
  records, and Celo data before confirmation.
- [ ] Email OTP verification and explicit acknowledgement are both required.
- [ ] A valid request returns `202` and a durable opaque reference.
- [ ] Concurrent/repeated submissions return the original receipt and do not
  refresh timestamps.
- [ ] A dropped final response can be retried safely.
- [ ] Pending accounts cannot use protected v1 APIs from another session.
- [ ] Direct personal data and Storage objects are deleted according to the
  approved inventory.
- [ ] Required records are pseudonymized, access-restricted, and assigned an
  approved retention period.
- [ ] Auth deletion runs only after dependent cleanup and does not fail on
  owned Storage objects or restrictive foreign keys.
- [ ] Celo records are neither mutated nor represented as erased.
- [ ] Completion or overdue state is observable without logging PII.
- [ ] `/account-deletion` is public, functional, and uses the same workflow.
- [ ] Privacy and terms accurately describe the shipping behavior.

### P0 — distribution and compliance

- [ ] Final bundle and package IDs are registered and no placeholder remains.
- [ ] Expo owner/project ID and development, preview, production, and submit
  profiles are configured.
- [ ] Production builds fail closed when required public configuration is
  absent or points to a non-production host.
- [ ] Build/version increments are reproducible and store URLs are live before
  a force-upgrade threshold changes.
- [ ] App icon, adaptive icon, splash, and store artwork pass visual review.
- [ ] No trial/unlicensed font is present in either binary.
- [ ] v1 is explicitly light-theme and iOS/Android-only.
- [ ] EAS Update is disabled.
- [ ] Apple privacy, Google Data safety, deletion URL, age/target audience,
  permissions, export, and financial-feature answers match the binary.
- [ ] Privacy, terms, deletion, support, and store links all return 200 over
  production HTTPS.
- [ ] Expo Doctor, lint, typecheck, unit tests, Hub tests/build, Maestro flows,
  EAS builds, artifact inspection, and physical-device checks are green.

## 18. Required evidence

Attach or link these artifacts to the release ticket:

- approved retention inventory and policy version;
- API/database test output and deletion-worker reconciliation output;
- before/after fixture inventory for a fully processed account;
- Maestro run output and physical-device checklist;
- final resolved Expo config for each EAS profile with values redacted;
- EAS build URLs and artifact inspection notes;
- App Store Connect and Play Console privacy/deletion screenshots;
- production link-check output;
- font licensing/procurement reference or replacement decision;
- signed-off store copy/screenshots; and
- rollback/incident owner and support escalation path.

## 19. Implementation slices

### Slice A — policy and inventory

- Approve member copy, 14-day target, retention matrix, and processor list.
- Inventory every user reference, Storage object, and external processor.
- Update canonical privacy and terms content.

### Slice B — web/backend deletion foundation

- Add migration, challenge/request domain logic, API contracts, worker,
  pending-account guard, public page, tests, and observability.

### Slice C — native account controls

- Add contracts/client methods, summary screen, OTP confirmation flow, receipt,
  session teardown, errors, analytics, and unit tests.

### Slice D — distribution foundation

- Finalize app identities, EAS project/profiles/environments, versioning,
  platform scope, light appearance, assets, and font licensing.

### Slice E — store package and validation

- Add Maestro, run physical-device tests, produce signed builds, inspect
  artifacts, complete console declarations, and assemble release evidence.

## 20. Decisions required before implementation

| Decision | Owner | Blocks |
|---|---|---|
| Final iOS bundle ID and Android package name | Product/engineering | External builds |
| Apple/Google/Expo organization accounts and credential owners | Operations | EAS/store setup |
| Retention purpose and period for every retained data class | Legal/data protection | Worker enablement |
| 14-day processing target and legal-hold copy | Legal/support | Member copy and SLA |
| Treatment of active vouchers and account-based Miles | Product/legal/finance | Confirmation and worker |
| Final production API/Supabase projects | Engineering/operations | Production environment |
| FT Sterling license evidence or replacement family | Brand/legal | Production binary |
| Support owner and deletion escalation SLA | Support/operations | Public page/store review |
| Store listing copy, screenshots, and review account procedure | Product/marketing | Submission |

The implementation can begin on schemas, UI structure, and non-production
workflow tests, but no production deletion processing or store submission may
proceed while these decisions remain unresolved.

## 21. Expected repository shape

Names may change to match local conventions, but the implementation should
remain within the existing packages and approximately follow this ownership:

```text
packages/akiba-app/
├── app.config.ts                     # resolved store identity/platform scope
├── eas.json                          # development/preview/production/submit
├── .maestro/
│   └── flows/                        # launch, legal, and deletion flows
├── docs/store-release/
│   ├── checklist.md
│   ├── metadata.md
│   └── privacy-data-map.md
└── src/
    ├── account-deletion/             # step state, error map, pure helpers
    ├── contracts/account-deletion.ts
    └── app/(tabs)/profile/delete-account.tsx

packages/hub-page/src/
├── app/account-deletion/
│   ├── page.tsx
│   └── AccountDeletionFlow.tsx
├── app/api/v1/me/
│   ├── account-deletion-summary/route.ts
│   ├── account-deletion/challenge/route.ts
│   └── account-deletion-request/route.ts
├── app/api/internal/process-account-deletion-requests/route.ts
└── lib/akiba/accountDeletion.ts

packages/website/src/content/legal.ts  # updated with Hub legal content
supabase/migrations/<next>_account_deletion_workflow.sql
```

Keep contracts, client code, auth state, and native UI inside
`packages/akiba-app`; do not create a new shared native workspace package or
manual native project directories.
