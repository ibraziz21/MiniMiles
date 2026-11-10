# Direct voucher issuance

Reference: `/Users/ibraziz21/Downloads/issuance.zip`.

The existing `/vouchers/grants` page now uses discrete member, voucher, review and success screens with the exported lavender canvas, white selection cards, teal progress/actions and compact mobile spacing. Member search keeps the actual username-only API rather than fabricating names, emails, tiers or locations. Available allocations use the authoritative remaining quantity and funding view; exhausted options are collapsed. Member eligibility is checked on Continue and again by the existing atomic issuance RPC.

Review shows the actual member, merchant, voucher, claim window, configured validity and maximum funding reservation. Issuance reason remains required. The optional note is appended to the existing audited operator reason. A synchronous request lock prevents double submission; a failed request keeps the same confirmation UUID for safe retry. Success links to the actual saved voucher, supports reset and does not claim SMS/push delivery. Issued detail uses the merchant's uploaded cover. Revocation is a bottom sheet on mobile and a contained dialog on desktop, with context, reason, optional note, authorization confirmation, error/retry handling and existing server/RPC enforcement.

## Submit → Publish

The separate Approve action is removed for funds and allocations at the user's request. Internal state names remain compatible. `sql/023_funding_submit_publish.sql` allows publication from `pending_approval` as well as existing `approved` rows. The existing atomic functions retain locking, expected revision, merchant readiness, template updates, audit and service-role-only grants. Legacy approval APIs remain compatible for other callers.

**Release dependency:** apply this migration to the Platform database before deploying the UI. It has not been applied live. Without it, the existing database rejects Publish from the submitted state. The migration changes functions only, with no record/budget writes.

## Verification

- Production build and 288 unit tests pass. Build retains a Next.js advisory about the direct merchant image element and old Browserslist data.
- 26 shared navigation, responsive and keyboard browser tests pass.
- Isolated issuance journey passes through all four screens at 320, 375, 414, 768, 1024, 1280 and 1440px; validates recipient/allocation payload, failed-request retry with the same UUID, saved-voucher link and reset.
- Isolated fund and allocation create → Submit → Publish journeys pass, including budget errors, required country rules, save retries and publication errors. Every financial browser request is intercepted.
- `sql/tests/submit_publish.sql` passes in disposable PostgreSQL: draft publication rejected, stale revision rejected, direct fund publication, merchant-readiness rejection with no leaked template/state update, successful atomic allocation/template publication, audit records and legacy approved/scheduled compatibility. The test bootstraps a reduced schema and is not a full Platform integration test.
- The authenticated isolated revocation sheet passes seven viewport checks and a rejected-request retry through saved revocation.
- Local issuance Lighthouse: performance 96, accessibility 100, best practices 100. Native 200% zoom and VoiceOver were not verified.

Fixtures, journeys, screenshots and audit JSON are in ignored `output/playwright/`. No real vouchers were issued/revoked, no live schema was changed, and nothing was deployed.
