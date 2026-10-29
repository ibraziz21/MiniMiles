# A07–A09 / A13: customer entitlement and accessible voucher flows

Status on 29 October 2026: **implemented and browser-verified against the local branch-backed Hub; production deployment pending**.

## One customer contract

[CustomerVoucherEntitlement](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/src/lib/vouchers/customerEntitlement.ts) carries the benefit, maximum discount, minimum purchase, terms, category/product restriction, redemption schedule, complete merchant count/resolved list and timing. Shared formatters and [summary/facts components](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/src/components/vouchers/VoucherEntitlementSummary.tsx) consume it on catalogue/merchant offer cards, funded confirmation, profile preview, wallet, owned detail and open QR. Owned v1 summaries/detail and the web presentation response expose the same additive DTO without removing legacy v1 response fields or shape gates.

Offer timing is a distinct union member: `claimDeadline` and `validForSeconds`, read from the allocation. Discovery now selects `voucher_validity_seconds`. Customer copy says **Claim by …** and **Valid for 7 days after claiming** separately. Issued timing contains only the voucher's stored `expiresAt`; claim success uses the expiry returned by the committed claim, never a date computed from the claim window.

Issued conditions merge `rules_snapshot` before live-template fallbacks. A later template edit cannot replace snapshotted benefit, cap, minimum, terms, category or product restriction. Explicit snapshot nulls stay null. Participants use the snapshot's IDs/count, including when a profile is missing. The shared disclosure names the available merchants and explicitly reports missing details; it never substitutes the primary for a larger set.

The owned web detail and QR show **10% off, up to KES200**, **Minimum purchase KES300**, the full three-merchant scope and the issued use-by date. The QR panel repeats concise purchase facts beside the code. Its short-lived token expiry is separate and labelled **QR refreshes in …**. Terms remain available in a native disclosure. The web wallet stops returning the raw snapshot. A presentation metadata lookup failure withholds the raw token with HTTP503 rather than returning a misleading partial contract. The page's immutable DTO remains a safe display fallback if a rolling-deployment endpoint omits the new response field.

The touched web-detail wallet lookup also now requires verified wallet links, matching the presentation and wallet endpoints.

## Keyboard transitions

[useDialogA11y](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/src/hooks/useDialogA11y.ts) reads the current close callback instead of retaining its initial closure. Escape is prevented during non-dismissible submission. Tab/Shift+Tab stay on the dialog when all child controls are disabled; the scrollable submitting container itself becomes a tab stop. Removed/disabled focus targets are recovered during state transitions, and the live heading announces checking, submitting and success states.

A dismissed eligibility request cannot reopen the modal when a delayed response arrives. Success stays in the dialog, shows the committed use-by date, then restores focus to the replacement **Claimed — view voucher** link. Failure is visible and dismissible with focus returning to the claim trigger. QR opening/closing also moves and restores keyboard focus; its controls are kept clear of the sticky header/Pass dock. Background dismiss controls are outside the keyboard sequence.

## Contrast and targets

Voucher actions and shared header/selected navigation use accessible teal tokens, with clear hover/focus states. Whole-card opacity no longer fades claimed/history text. The Free badge uses a darker green; disabled text remains readable. Merchant links, disclosure summaries, terms rows and funded claim actions have 44px minimum height, with explicit chevrons and focus rings. Native disclosure behavior is retained.

| State/pair | Contrast |
| --- | ---: |
| White on primary teal | 6.25:1 |
| White on hover teal | 8.42:1 |
| Merchant link on card | 5.83:1 |
| White on Free badge | 5.02:1 |
| Selected teal on tint | 5.71:1 |
| Disabled text on card | 7.91:1 |

Full-page checks also found and fixed the previously unnamed mobile profile link. Mobile scroll padding and end spacing account for the Pass dock. The offer header now uses a solid pale background, allowing contrast to be verified directly rather than leaving gradient text as an axe incomplete result.

## Verification

- **14 new unit cases:** seven entitlement invariants, four keyboard-hook cases, two presentation-contract cases and one wallet-contract case. They use a plain title without conditions, different claim/issued dates, changed live templates and incomplete merchant profiles.
- **Full Hub unit run:** 1,118 passed, one skipped, one known pre-existing account-deletion support-email assertion failure. Hub typecheck passes.
- **Real Chromium keyboard flow:** checking → eligible → deliberately delayed submission → success, plus delayed checking cancellation and claim failure. Escape/Tab/Shift+Tab cannot dismiss or leave submission; success uses a 5 November committed expiry rather than the 30 December claim deadline; focus returns correctly. These UI claim responses were intercepted: no new claim was sent to the database.
- **Real branch-backed profile/wallet/detail/QR:** synthetic member 2's issued voucher retains cap, minimum and three merchants. The real presentation endpoint returns the same conditions and distinct voucher/token expiries. Keyboard QR open/close preserves visible focus and the real DELETE succeeds. Presentation tokens were generated and revoked; no voucher was claimed/redeemed or financial records created.
- **Axe 4.11.1:** zero violations and zero incomplete results in the final full-page expanded catalogue scan; fixture card hover/focus, confirmation with disabled/ready controls, submitting and success scans; and real owned-detail/open-QR scans. These are nine tested states/surfaces, not a WCAG certification.
- **Geometry:** 320, 375, 414, 768, 1024 and 1440 CSS-pixel widths have no horizontal overflow on catalogue or owned detail. Measured merchant links, disclosure/terms rows and funded card actions are 44px high (allowing normal floating-point measurement precision).

The temporary local route rendering the real claim components was removed after verification, along with its generated route type; it is not shipped. Delayed UI requests used that fixture, while catalogue and owned/QR checks used the real synthetic branch. No new database migration was needed.

Private/redacted receipts are ignored under `.verification/a07-a13-a11y-browser-result.json`, `.verification/a07-owned-browser-result.json`, `.verification/a07-keyboard-browser-result.json` and `.verification/a07-a13-unit.log`. Screenshots are under `output/playwright/a07-a13-*.png`; no live QR token was saved in a screenshot or log.

## Rollout and limits

Deploy the Hub UI, shared contract/loaders and API changes together, then repeat the customer flow on the deployed origin. Production was not modified. No full production build, deployed-origin validation, VoiceOver/screen-reader or browser matrix is claimed. The existing development preview hit intermittent Next.js hot-reload renderer errors during edits; final browser checks passed after recovery with the source stable. Existing A06 offline-navigation restrictions remain in force.

Other audit findings, production deployment of prior repairs and production migration-order reconciliation remain separate work.
