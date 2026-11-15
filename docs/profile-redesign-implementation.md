# Native profile redesign — 002appprofile

Implemented the newer profile layouts from the supplied Stitch export. Uses DM Sans, a compact centred identity header, deep teal accents, quieter cards, and three primary tabs: My rewards, Saved, My shares. Existing global app navigation remains intact, including Offers and the raised Pass control.

## Working flows

- My rewards: available Miles; active/used/expired owned vouchers; pagination; existing voucher details and secure QR presentation; preparing vouchers open their status screen.
- Saved places: authenticated, paginated account collection; open merchant; remove and Undo.
- Liked offers: per-member device persistence independent of the 40-entry swipe history; legacy hearts imported where available; remove and Undo; business offers open their merchant, funded rewards open the existing claim detail screen.
- Reminders: show this member’s local scheduled alerts and service reminders recorded from Offers/merchant pages on this device; change timing; explicit cancellation confirmation; notification-settings recovery. Legacy service reminder decisions are checked against the service before importing. Reminder execution remains with its original service. Local reminders carry member ownership and are cancelled on sign-out.
- My shares: authenticated paginated contributions, accurate recommendation sentiment, tried items, selected experience labels, per-photo moderation state, eligible contribution prompts. Opens existing web contribution editor and refreshes on return. Existing native photo upload sheet plus per-photo withdrawal. Sharing offered only for contributions in the canonical public eligibility projection; private item labels are never put in the shared link/story.
- Activity: separate screen, earned/spent filters, dated groups, detail sheet with real activity reference. Shows the most recent 100 source-aggregated activities, explicitly labelled as recent history, not a full statement. Strict reads return a friendly failure instead of false empty history.
- Independent loading, empty, failed, refresh and pagination states. Failed refreshes retain previously loaded data. API error text is not printed directly in these new screens.

## Backend release dependency

Deploy hub-page with the app update. No database migration is required. New authenticated, private/no-store endpoints:

- `GET /api/v1/me/saved-places?offset=0`
- `GET /api/v1/me/community-shares?offset=0`
- `GET /api/v1/me/activity`

Reads reuse existing ownership, contribution, photo, voucher and ledger tables. Community share responses contain private member data and must never be publicly cached. Processed photo derivatives are signed for five minutes; originals are not returned.

## Deliberate boundaries

- Tier qualification/discount pricing is not implemented: thresholds, qualification window, refund treatment and funding rules remain undefined. No illustrative tier benefits or referral rewards from old export screens were copied into production.
- Likes and the service-reminder index are device-local, scoped to the signed-in member. The UI states this. There is no cross-device liked-offer/reminder-list API. Reminders created on another device or old merchant-page reminders without a stored index are not discoverable in this list. Existing account-synced saved places and shares are unaffected.
- Community content uses the existing structured answers. It does not fabricate the free-form review quotes in the design export.
- The existing Settings page, contribution form, voucher claim/detail/QR screens, and photo upload sheet are reused rather than replaced by static designs.

## Validation

App and backend TypeScript checks; app lint; targeted backend lint; focused tests for account scoping, authenticated reads, pagination, failed reads, private share data, concurrent local saves and reminder ownership. Android Metro bundle compiled successfully. No connected Android device was available, so native visual and end-to-end smoke verification remains a release check.
