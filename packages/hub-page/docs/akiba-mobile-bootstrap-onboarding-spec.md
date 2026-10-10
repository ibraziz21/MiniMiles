# AKIBA-MOB-001: App Bootstrap and First-Run Onboarding

- **Packages:** `packages/akiba-app`, `packages/hub-page`
- **Status:** Implemented — conditional pass (see §8)
- **Priority:** P0 launch blocker
- **Followed by:** `AKIBA-MOB-002` (account controls and store compliance)
- **Target:** Kenya-only iOS and Android launch
- **Last reviewed:** 2026-10-10

Checked in retrospectively so the acceptance criteria are traceable rather
than living only in a conversation. The requirements below are the spec as
given; §7 and §8 record what was built against each and what is still open.

---

## 1. Objective

A new Kenyan member can install Akiba Pass, verify their email, complete a
short onboarding flow, and reach a useful Explore screen in under two
minutes. Returning members resume directly where they belong.

## 2. Core flow

```text
App launch
→ Load remote configuration
→ Restore authentication
→ Maintenance / forced-upgrade check
→ Sign in and verify OTP
→ Load member bootstrap
→ Onboarding if incomplete
→ Explore
```

## 3. Requirements

### 3.1 App bootstrap

- Fetch `/api/v1/config` during cold start.
- Handle maintenance mode.
- Block unsupported versions with an "Update Akiba Pass" action.
- Apply feature flags before rendering tabs.
- Use legal URLs returned by config.
- Show a recoverable connection state if bootstrap fails.
- Hide unfinished destinations such as Gifts through feature flags.

### 3.2 OTP authentication

- Visible email and verification-code labels.
- Email validation before submission.
- OTP autofill and paste support.
- "Change email" and predictable back navigation.
- Resend countdown, such as 30 seconds.
- Friendly mapped errors instead of raw Supabase messages.
- Privacy Policy and Terms links before account creation.
- Preserve the flow when the app backgrounds and returns.

### 3.3 Onboarding — three screens

1. **Welcome to Akiba** — discover trusted places; earn AkibaMiles; use
   rewards at participating merchants.
2. **Set up your profile** — username; country fixed to Kenya; optional
   city; explain how location improves recommendations.
3. **Your Akiba Pass** — how merchants scan the Pass; vouchers live under
   Rewards; primary CTA "Explore Akiba".

Location permission is requested only after the member chooses "Near me",
never during onboarding.

### 3.4 Persistence

- Implement `POST /api/v1/me/onboarding/complete`.
- Completion must be idempotent.
- Store completion server-side.
- Existing members with completed onboarding skip it.
- An interrupted member resumes at the appropriate step.
- Profile fields saved during onboarding must not be requested again.

### 3.5 Accessibility

- Minimum 44pt iOS / 48dp Android touch targets.
- Normal text contrast of at least 4.5:1.
- VoiceOver and TalkBack labels for every control.
- Errors announced and placed beside the affected field.
- Largest system text size must not clip content.
- Onboarding must remain usable without animation.

### 3.6 Measurement

Non-PII events only: `sign_in_started`, `otp_sent`, `otp_verified`,
`onboarding_started`, `onboarding_step_viewed`, `onboarding_completed`,
`onboarding_abandoned`, `bootstrap_failed`, `upgrade_required`.

Never send email addresses, OTPs, access tokens, or precise coordinates.

## 4. Acceptance criteria

- [x] New member completes the entire journey on iOS and Android — **code
      complete; not device-verified**
- [x] Returning member bypasses onboarding
- [x] Expired sessions return safely to authentication
- [x] Maintenance and forced-upgrade states work
- [x] Killing and reopening the app does not lose onboarding progress
- [x] Slow, offline, and failed-request states provide retry actions
- [x] No raw server errors are displayed
- [x] Legal links load successfully — **code complete; production URLs not
      yet link-checked**
- [x] Lint, TypeScript and unit tests pass
- [ ] Onboarding E2E tests pass — flows written (`.maestro/flows/`), never run
- [ ] Verified on physical iPhone and mid-range Android devices

## 5. Out of scope

Account deletion and store compliance (`MOB-002`); rotating Pass QR and
offline behaviour (`MOB-003`); voucher presentation and merchant redemption
(`MOB-003`); push notifications and deep links; Gifts, referrals and
advanced personalisation.

## 6. Where it lives

| Requirement | Implementation |
|---|---|
| Config gate, maintenance, force-upgrade | `akiba-app/src/config/` (`AppConfigProvider`, `version.ts`) |
| Launch state screens | `akiba-app/src/components/launch-screens.tsx` |
| Member bootstrap | `akiba-app/src/member/MemberProvider.tsx` |
| OTP sign-in / verify | `akiba-app/src/app/(auth)/`, `akiba-app/src/auth/{email,errors,otp,resend}.ts` |
| Onboarding steps and resume | `akiba-app/src/app/onboarding/`, `akiba-app/src/onboarding/` |
| Analytics and PII scrubbing | `akiba-app/src/analytics/` |
| Completion endpoint | `hub-page/src/app/api/v1/me/onboarding/complete/route.ts`, `hub-page/src/lib/akiba/onboarding.ts` |
| Gifts flag | `hub-page/src/lib/featureFlags.server.ts` (`nativeGiftsFlag`), `resolveCapabilities.ts` |

## 7. Corrections made after the first implementation review

1. **Config was not re-gated on an in-session auth change.** When the access
   token changed, `AppConfigProvider` refetched without closing the gate, so
   children could render for a round trip against the previous actor's
   feature flags. The loaded config now records which token it belongs to and
   the gate reopens until a refetch for the current actor lands.
2. **A database failure was read as "not onboarded".**
   `GET /api/v1/me/bootstrap` ignored the error from its
   `hub_user_passes.onboarding_seen_at` read and returned `false`, which
   would walk an established member back through onboarding — and re-ask for
   profile fields they had already set — during a transient outage. It now
   returns a retryable 503 and the app shows its connection-error screen.
3. **`maxLength` broke rich-text OTP paste.** Both React Native and the
   browser truncate a paste *before* the change handler runs, so a
   six-character cap turned "Your Akiba code is 123456" into "Your A". The
   cap is removed from every OTP field; `toVerificationCode` does the
   clamping, which is the only arrangement where that paste works.

## 8. Why this is a conditional pass

Everything in §3 is implemented and covered by unit tests, lint and
typecheck. Two classes of evidence are missing and neither can be produced
from a development machine:

- **Device verification** (§4) — OTP autofill behaviour, paste from a mail
  app, VoiceOver/TalkBack, largest-text-size layout, and background recovery
  all need real hardware.
- **E2E execution** — the Maestro flows exist but need a development or
  preview build and a non-production OTP harness.

Until both are done, MOB-001 should be treated as feature-complete and
unverified, not closed.
