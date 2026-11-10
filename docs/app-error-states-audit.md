# Akiba error states: audit and proposed UX

Reviewed November 9, 2026. Scope: native screens, API client, auth, launch/member
providers, local actions, media, and corresponding v1 error responses. This is
a source audit and implementation specification, not a device acceptance test.
It does not identify the exact historical 422/500 requests without their logs or
request IDs. No application behavior is changed by this document.

## Findings

1. `src/api/client.ts` builds an HTTP-status fallback when a response has no valid
   error envelope. Many screens render the resulting `error.message` verbatim.
   The existing change in `src/api/errors.ts` preserves server explanations, but
   does not guarantee friendly copy: unknown upstream text and technical fallback
   messages can still reach users. Zod response-validation errors and raw network
   errors also reach the same rendering paths.
2. `readApiErrorEnvelope` reads code/message/retryable, but most screens do not use
   those fields to choose a recovery action. Server codes also mix lowercase and
   uppercase. The parser should tolerate malformed envelopes without throwing.
3. Purchase, funded-claim, and loyalty-claim screens flatten initial-load failures,
   business-rule rejections, and lost mutation responses into one error state.
   A generic Retry button does not explain whether the operation took effect.
4. `fetchWithTimeout` stops its timer when response headers arrive. Reading the
   response body is outside the timeout; a stalled JSON body can leave loading
   unresolved. JSON failures become null and then a raw schema error on a 2xx.
5. Home silently treats a failed voucher-state read as no claims. Merchant detail
   silently treats a failed private overlay as unsaved/no helpful reactions/no
   contribution opportunity. Failed merchant saves roll back with no explanation.
6. Rewards loads catalogue, personal state and owned vouchers using one
   `Promise.all`; one failure removes access to all three sections. Offers already
   isolates a failed voucher catalogue, providing a pattern to extend.
7. Launch configuration failures all use a connection failure state, even when the
   cause is a server error or incompatible response. Maintenance lacks an explicit
   recheck action; failed store-link opening is swallowed.
8. Sign-in's code-based auth mapping, merchant pagination errors, per-photo upload
   feedback, the report sheet, and account-deletion step recovery are useful existing
   patterns. Preserve them and close their remaining gaps.
9. No custom exported Expo Router error boundary was found in the native routes.
   Unexpected render failures need a member-facing recovery fallback rather than
   relying solely on framework defaults. This cannot recover native process crashes.

## Common UX rules

- Distinguish empty, loading, failed, unavailable, not eligible, and outcome unknown.
- First load with no content: a page state with a short title, explanation and
  one primary recovery action. Keep Back and tab navigation available where possible.
- Refresh failure: keep previously loaded content, mark it as not updated and offer
  Retry. Never present stale balance/eligibility as permission to spend or claim.
- A section failure affects that section. A form failure stays in the form. A small
  action failure stays beside the action or in an accessible transient message.
- Keep typed values, selected filters, photo choices and scroll position. Refresh
  expired terms/quotes, and require confirmation again if material terms change.
- A business restriction gets the action that resolves it; it is not a red system
  failure and should not repeatedly offer an ineffective Retry.
- Never display raw HTTP statuses, JSON/schema details, database errors, endpoint
  names, configuration keys or arbitrary upstream messages in the main copy.
- Never claim that an action failed, nothing changed, or no Miles were spent unless
  an authoritative result establishes that fact.
- Never automatically repeat a spend/claim/delete submission without a proven
  idempotency/reconciliation contract. Retrying a status lookup is different.
- Retry buttons show progress and block duplicate taps. Stop background retries
  when the screen is left; do not turn a service outage into a request storm.
- Announce new errors once to assistive technology; associate field errors with
  inputs. Do not rely on red alone, truncate recovery text, or force transient
  messages to carry the only recovery action.

## Failure classification and copy

HTTP status is a fallback; stable code plus operation context determines the UX.

| Failure | Proposed copy and behavior |
| --- | --- |
| Transport failure during a read | “We couldn’t connect to Akiba. Check your connection and try again.” / Try again. Do not claim the phone is offline unless connectivity is known. |
| Read timeout | “This is taking longer than expected. Please try again.” / Try again. |
| 500/502/503 during a read | “We couldn’t load [content] right now. Please try again shortly.” / Try again. Never blame the user’s connection for a known service error. |
| 400/422 validation | Specific field or requirement feedback; preserve the form and focus the affected input where appropriate. |
| `INSUFFICIENT_MILES` | “You need more Miles for this reward.” Show required/available/gap only when returned by trusted data. / Explore places; secondary Back to rewards. |
| `USERNAME_REQUIRED` | “Choose an Akiba username to claim this offer.” / Add username, then return to this offer and recheck eligibility. |
| `COUNTRY_PROFILE_REQUIRED` | “Add your country to check this offer’s availability.” / Update profile. Do not tell a member to select an inaccurate country. |
| `COUNTRY_NOT_ELIGIBLE` | “This offer isn’t available in your country.” / Browse other offers. |
| Quote expired/not found | “Your offer details need refreshing.” / Refresh details. Show the new terms before another confirmation. |
| Already claimed | A normal Claimed state, preferably linking to the existing voucher. / View voucher or My vouchers. |
| Sold out, inactive, expired or removed offer | “This offer is no longer available.” / Browse offers. No infinite Retry. |
| 401/session expired | “Please sign in again to continue.” Recover the session once where supported, then offer sign-in. Preserve the intended destination; never sign out for a network or server failure. |
| 403 | Known eligibility/account restriction copy, with Browse offers or Contact support as appropriate. Do not treat every 403 as an expired session. |
| 404 merchant/voucher/visit | “This [place/voucher/visit] is no longer available.” / Return to the relevant list. Avoid saying an owned voucher expired unless its status proves that. |
| 410 | Interpret by code/context: pending account deletion is a dedicated account state; removed resources are unavailable states. |
| 429 | “You’ve tried a few times. Please wait before trying again.” Honor valid Retry-After or a returned cooldown, show countdown, preserve inputs. |
| 2xx with invalid/missing response data | “We couldn’t load the latest details.” / Retry read. During a mutation, enter outcome checking. Log the contract failure privately. |
| Unknown code or malformed/non-JSON 4xx/5xx | Safe context-specific fallback; retain diagnostics for support. Never render the raw response. |
| Timeout/network/5xx after mutation starts | “We couldn’t confirm whether this went through.” / Check status. Keep a way back to My vouchers or the relevant receipt. |

## Per-flow failure map

| Point of failure | Current gap or baseline | Proposed failed state and recovery |
| --- | --- | --- |
| Session restore | Auth restore rejection falls back to no session | Safe signed-out state; explain that sign-in is needed if local session recovery fails. Never show another member’s cached data. |
| Remote configuration | One connection state for every error | Separate connection, service unavailable, maintenance and update-required states. Retry/recheck without restarting; secondary support after repeated failures. |
| Member bootstrap | Retry screen; 401/410 special handling exists | Retain dedicated session/deletion handling. Other failures use account-load state; never clear the session for 5xx or timeout. |
| Unexpected screen rendering | No custom route boundary found | “This screen couldn’t open.” / Reload screen; secondary Go to Explore. Attach a private diagnostic reference. |
| Email sign-in/send code | Friendly mapped errors already exist | Inline message below email; keep email. For rate limits show resend cooldown. Keep the alternative sign-in method accessible. |
| OTP verify/resend | Mapped invalid/expired codes exist | Inline code error, preserve email; Request new code for expiry, countdown for resend. A server failure should not label the code incorrect. |
| Password sign-in | Code-based mapping exists | Keep existing safe credential message and code-sign-in alternative. Preserve email; do not expose account-existence information. |
| Onboarding profile | Inline save error exists | Username errors at username; availability errors near Continue. Keep city and username; actionable country/profile restrictions. |
| Onboarding completion | Dedicated save failure copy exists | Stay on the step with Retry saving; a lost response checks bootstrap before repeating completion. Do not restart onboarding. |
| Explore/Home feed | Raw error messages possible; refresh replaces state on failure | First load gets page retry; refresh keeps content with a banner. Retry the feed without resetting navigation. |
| Home claimed-state overlay | Failure becomes an empty claimed list | Keep feed, show “Your reward status couldn’t be updated.” / Retry status. Claim buttons recheck before allowing a claim. Unknown must not mean unclaimed. |
| Merchant search/filter | First-page failures clear results | Preserve search/filter values. New search failure says results could not load, not “No places found.” For same-query refresh retain old results with an update warning. |
| Merchant pagination | Existing footer failure state | Keep loaded cards; footer “More places couldn’t load.” / Load more. An invalid cursor refreshes the list rather than replaying the same bad cursor. |
| Near me/location | Denied fallback exists | Permission denial: Open settings and Browse by city. Timeout/service/location failure: Retry location or city filter. No blocking app-wide error. |
| Merchant public details | Raw error + retry | Unavailable/not found: Back to places. Temporary failure: retry page. Keep known details on refresh, with stale-state notice. |
| Merchant personal overlay | Failure becomes false saved/helpful/no visit state | Keep public profile. Small “Your saved and visit status couldn’t load” panel / Retry. Disable only actions whose state is unknown, not the entire page. |
| Save/unsave merchant | Silent optimistic rollback | Restore previous state; “Couldn’t save this place.” / Retry, or “Couldn’t remove this saved place.” Keep the profile open. |
| Helpful reaction | Rollback and alert exist | Rollback with action-level feedback. If the visit was removed, refresh that visit card rather than asking to retry forever. |
| Report visit/photo | Inline failed result and duplicate acknowledgement exist | Keep reason and sheet. Retry sending; separate a removed visit from a service failure. Already reported remains a successful acknowledgement. |
| Open/add/edit verified visit in browser | Generic alerts; missing config key can appear in copy | “We couldn’t open your visit.” / Try again; secondary Copy link when a valid link exists. No configuration details. Refresh eligibility after returning. |
| Visit eligibility | Missing request reads as no action; cooldown reasons can be invisible | Explicit Checking / Eligible / Not eligible yet / Couldn’t check status. Explain known cooldown/window/earning requirements; retry only a failed check. Requires API reason data where currently absent. |
| Photo permission/picker/camera | Permission text exists; native calls can reject | Keep sheet and selected photos. Open settings for denial; choosing Cancel is not an error. Camera failure offers Choose from library. |
| Photo format/size/limit | Client validation and one limit mapping exist | Specific inline message beside Add photo or affected thumbnail. Offer Choose another or Remove a photo. No whole-visit error. |
| Photo upload intent/storage/completion | Per-photo error exists; raw storage/API text possible | Keep successful photos and selected asset; “This photo couldn’t upload.” / Retry photo or Remove. If final confirmation is uncertain, check photo state before re-uploading. Visit remains saved. |
| Withdraw/delete photo | Failure may restore only local status | Keep the photo until confirmed removed; inline Retry removal. If outcome is unknown, refresh photo state. |
| Offers feed | Retry state; optional catalogue failure isolated | Retain existing isolation. First load page retry; optional rail gets its own Retry. Empty deck and service failure must remain distinct. |
| Heart/dismiss offer storage | SecureStore failure swallowed | Keep the current session usable. If persistent save fails, discreetly say choices may not be saved on this device. Do not promise account sync. |
| Offer reminder save/remove | Alert with raw messages; local and server reminders differ | Keep the card/details visible. Inline reminder error and Retry; denial offers Open settings. Past time offers Choose another time. For server timeout, read reminder state before claiming save/remove failed. |
| Rewards catalogue/personal state/My vouchers | One rejection fails all three reads | Independent section states. Keep My vouchers usable if catalogue fails, and catalogue usable if owned vouchers fail. Personal state unknown must not become zero balance/unclaimed. |
| Paid voucher quote | Same generic error state as purchase | Insufficient Miles: requirement panel with Explore places. Removed/unavailable: Browse rewards. Quote-service 500: retry details, preserving reward identity. |
| Paid voucher confirmation | Mutation errors flatten to retry; retry discards quote/intent/use plan | Preserve context. Definitive rule rejection gets a repair action. Lost/5xx response gets Checking purchase, then confirmed success, confirmed rejection or unresolved state. Do not generate a new purchase intent until the previous result is known. |
| Funded claim eligibility | Generic load error; explicit ineligibility baseline exists | Retry eligibility in the sheet. Known requirements get Add username/Update profile/etc. Already claimed links to voucher. Missing inventory gets Browse offers. |
| Funded claim submit | Generic Retry after every error | Keep offer summary and choices. Reconcile eligibility/owned voucher using the existing idempotency contract. View voucher after success; Check status for uncertainty. |
| Loyalty claim | Error Retry returns to idle with route-param eligibility | Refresh live eligibility instead of trusting old route params. Distinguish not yet qualified, already claimed, unavailable and uncertain submission. |
| Owned voucher details | Generic error even for missing voucher | 404: Back to My vouchers. Service failure: retry details. Keep known non-sensitive facts on refresh; never show a stale QR. |
| Voucher preparing/claiming | Existing preparing/status refresh state | Treat as pending, not failure. Explain preparation, refresh status with bounded polling, and offer support if unresolved. Do not invent a completion ETA. |
| Voucher QR issue/refresh/polling | Fail-closed behavior already present; raw issue errors possible | Keep voucher details. Replace QR with “Reconnect to show your voucher” for transport, or “We couldn’t refresh your voucher” for service failure. Retry QR; used/expired moves to its real status. |
| Pass details/live QR | Existing unexpired presentation retained on refresh failure | Keep an unexpired live Pass only under its existing validity rules. Once expired, replace QR with a clear Refresh Pass action. Distinguish missing account requirements from service failure. |
| Profile overview/activity | Generic whole-profile failure | First-load retry; preserve last view on refresh. Add section-level availability when backend can distinguish failed balance/activity/saved reads. Do not show failed stats as zero. |
| Settings read/save | Save may render raw API/Supabase messages | Keep the editor and typed values. Username conflict next to field; service error near Save. Use auth mapping for password update. Re-read settings if response was lost before asserting saved/unsaved. |
| Notification permission/device registration | Token/API failures retry quietly; early native permission/channel exceptions can escape | App stays usable. Settings shows Not allowed vs Couldn’t finish setup vs Enabled when known. Settings retry for registration, Open settings for denial; no repeated global alerts. |
| Account deletion summary/challenge/submit | Dedicated step-aware resolver exists | Preserve it. Mask unknown server text, distinguish delivery cooldown/invalid code/policy changes. Lost submit response checks existing request or reuses its idempotent submission; never falsely confirm deletion. |
| Sign-out/device unregistration | Best-effort unregistration and local cleanup exist | Clear personal local UI promptly; show local sign-out recovery if cleanup fails. Do not claim remote device revocation succeeded without confirmation; device-isolation testing remains required. |
| Share/clipboard/story export | Several useful local fallbacks exist | Keep preview; Retry export/share or Copy link. Share-sheet cancellation is neutral. Failed image export must not claim a card was shared. |
| Merchant/photos/images | Some image fallbacks exist, not uniform | Branded neutral fallback without removing card actions. For visit evidence show Image unavailable, not an unrelated replacement photo. |
| Support/legal/maps/store links | Some launch failures swallowed | Inline “We couldn’t open [destination].” / Try again; Copy link/address/email fallback where valid. Remain on the current screen. |

## Shared implementation contract

Introduce a pure resolver rather than making each screen interpret raw exceptions:

```ts
resolveAppFailure(error, {
  operation,       // load_rewards, quote_voucher, purchase_voucher, save_profile…
  phase,           // read | submit | reconcile
  hasContent,
}) => {
  kind,            // connection | service | validation | restriction | session |
                   // unavailable | rate_limit | outcome_unknown | unexpected
  title,
  message,
  presentation,    // page | section | inline | banner | action | pending
  action,          // retry_read | refresh_quote | explore | edit_profile |
                   // sign_in | open_settings | check_status | contact_support
  retryAfterSeconds,
  diagnosticRef,
}
```

Use allowlisted code-to-copy mappings and safe context defaults. Keep the original
status, code, cause, operation, request ID and retry information for diagnostics;
do not log tokens, OTPs, QR payloads, email addresses, photo URLs or request bodies.
The API already returns `error.requestId`; retain the generated request ID even
when a response is malformed. A short support reference can be disclosed under
Details/Contact support, separate from the main explanation.

Build reusable page/section failure, inline form error, action feedback, and
pending-outcome components using the existing app tokens. Use existing auth and
deletion resolvers as domain adapters; do not replace their special transitions
with a generic error component. The resolver chooses the recovery intent; the
screen owns navigation and state preservation.

Cover the whole fetch-and-body-read deadline. Normalize transport, HTTP and
response-contract failures separately. Do not implement a blanket auto-retry of
all requests or blindly accept `retryable` as permission to repeat a mutation.

### Backend work required for complete UX

- Supply structured business reasons and relevant safe facts, not only free text
  or a coarse unavailable code. Visit eligibility needs a reason and, when known,
  the next eligible time. Insufficient Miles needs trusted amounts to show a gap.
- Expose authoritative purchase/claim status tied to a durable operation identity
  if existing quote/claim/owned-voucher reads cannot uniquely resolve an attempt.
  Owned voucher lists alone may be insufficient when multiple claims are allowed.
- Ensure exceptions still return the standard error envelope; preserve request
  IDs and cooldown headers. Some upstream business codes are currently collapsed
  into broad errors, so frontend mapping alone cannot recover the lost meaning.
- Return partial availability where aggregates currently hide a failed component
  or collapse the whole response. Never substitute an empty list/zero for unknown
  personal balance, claim or eligibility state.

## Implementation order

1. **P0 — prevent technical error leakage:** shared failure resolver; safe status
   fallbacks; malformed/HTML/empty-body handling; whole-response timeout; remove
   direct unknown-message rendering. Keep diagnostics private and correlated.
2. **P0 — purchases and claims:** separate load/restriction/submit/reconcile states;
   add insufficient-Miles and repair actions; prove idempotency and status lookup.
3. **P1 — partial loading and refresh:** independent Rewards sections; Home and
   merchant overlays retain unknown state; preserve loaded screens and inputs.
4. **P1 — local actions and permissions:** save/helpful/reminder feedback; upload
   recovery; live QR errors; push setup status; external-link fallbacks.
5. **P1 — launch/account consistency:** session, maintenance, rate-limit and update
   states; route error boundary; retain deletion-specific protections.

## Acceptance checks

For every read: first load, refresh with existing content, offline/transport error,
timeout before headers, stalled response body, 401, 403, 404, 422, 429, 500/502/503,
HTML/empty/malformed error response, unexpected 2xx payload and successful retry.
Use only applicable cases per endpoint; statuses alone do not define the outcome.

For every mutation: rejection before commit, commit followed by lost response,
commit followed by 5xx, duplicate tap, navigating away during submit, returning
after restart, same-operation retry, changed eligibility/terms, and reconciliation
that finds success, rejection or remains unavailable. Assert no duplicate spend or
claim and no false statements about the balance or result.

For every partial screen: fail one dependency at a time and prove unaffected
content remains usable, failed sections are not mistaken for empty states, and
unknown member state cannot enable a misleading action.

On iOS/Android devices: VoiceOver/TalkBack announcement, large text, keyboard-visible
field errors, back/cancel behavior, repeated Retry taps, airplane mode, denied and
later-granted permissions, background/foreground, missing external handlers, and
return from browser/Settings. Audit and test results are separate evidence: these
checks have not been executed as part of this source audit.

## Main source locations

- `packages/akiba-app/src/api/{client,errors,timeout}.ts`
- `packages/akiba-app/src/auth/{AuthProvider,errors}.tsx` (errors is `.ts`)
- `packages/akiba-app/src/config/AppConfigProvider.tsx`
- `packages/akiba-app/src/member/MemberProvider.tsx`
- `packages/akiba-app/src/app/(auth)/{sign-in,verify}.tsx`
- `packages/akiba-app/src/app/onboarding/{profile,pass}.tsx`
- `packages/akiba-app/src/app/(tabs)/{index,offers,pass}.tsx`
- `packages/akiba-app/src/app/(tabs)/merchants/{index,[slug]}.tsx`
- `packages/akiba-app/src/app/(tabs)/vouchers/` and `components/funded-offer-claim.tsx`
- `packages/akiba-app/src/app/(tabs)/profile/` and `account-deletion/errors.ts`
- `packages/akiba-app/src/components/verified-visit-{photo,report}-sheet.tsx`
- `packages/akiba-app/src/components/{launch-screens,place-share-sheet,place-story-card,legal-links}.tsx`
- `packages/akiba-app/src/lib/{voucher-presentation,offer-decision-storage}.ts`
- `packages/akiba-app/src/push/{register,PushRegistrar,funded-offer-reminder}`
- `packages/hub-page/src/lib/api/v1/response.ts` and `src/app/api/v1/`
