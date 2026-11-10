# Flow 2: queue and merchant review

Implemented from `flow2.zip` on 9 November 2026. The ZIP is a visual reference; server permissions, completeness checks, lifecycle validation and audit logging remain authoritative.

## Implemented

- `/ops-queue`: compact review rows, merchant/keyword search, All/Merchants/Photos/Reports filters, secondary age/order controls, and a separate verified-visits link. Search and filters survive review and back navigation through URL state.
- The pending queue reads only publishing, photos and reports. Verified visits retain their existing dedicated page and are not treated as awaiting approval.
- Loading, no-pending, filtered-empty and unavailable presentations remain distinct. Retry refreshes the current queue without discarding URL filters.
- `/directory-reviews/[id]`: actual cover/logo images, description, categories, locations, readable opening hours, public contacts and offerings. Additional vouchers and history are collapsed.
- Authenticated submitted-profile preview via `preview=1`, with no write controls.
- Short publish confirmation and request-changes dialogs. Merchant-visible messages, optional affected sections and internal notes use the existing API contract.
- Success summaries link back to the filtered queue and to the next merchant when one exists. Suspend and restore remain available as secondary actions for the existing permitted statuses.
- Overview bell categories now open the corresponding filtered queue.

No stock merchant photographs, KYC badges, EXIF checks, payment integrations, regulatory claims or new moderation powers were introduced. The existing preview RPC exposes cover/logo images, not the four-image gallery in the mockup. There is no reliable published-versus-submitted snapshot in this flow, so no comparison was fabricated. Photos/reports still open their existing specialist moderation pages; their separate redesigns remain future flows.

## Freshness fix

Browser inspection exposed cached queue rows whose profile statuses had already changed. The server-only Supabase client now forces `cache: no-store`, including in local open-access sessions. The queue then correctly reflected the current pending submission. This applies consistently to administrative reads, including payment and review states. Server transition checks remain intact. No service-worker policy, credentials or schema changed.

## Verification

- Production build and TypeScript/lint checks pass.
- 44 unit files / 273 tests pass, including safe return paths, opening-hours display, exclusion of visits from the pending queue, and admin-fetch caching.
- Queue and review rendered at 320, 375, 414, 768, 1024, 1280 and 1440px without horizontal overflow; screenshots saved locally.
- Search, category filtering, filtered-empty presentation, submitted-profile preview and return URL verified in Chromium.
- Review modal cancellation restores focus. API errors, successful change requests and successful publishing verified with intercepted POST requests. No real merchant record was modified during these tests.
- 26 existing responsive, overview, keyboard and mobile navigation tests pass after the freshness change.
- Lighthouse queue: performance 96, accessibility 100, best practices 100. Review: accessibility 100, best practices 100. Local lab results are not field measurements or a complete WCAG conformance claim.
- Full VoiceOver and native 200% browser zoom remain unverified. Empty filters and mocked action failures were exercised; no production outage or destructive lifecycle change was induced for testing.

Artifacts are ignored under `output/playwright/`: `flow2-queue-375.png`, `flow2-review-375.png`, responsive variants, audit JSON, and explicitly named `*-mocked.png` decision screenshots. Mocked screenshots are test evidence, not real publishing outcomes.

## Limits

The queue retains its existing cap of 150 entries per source and discloses that limit. Counts describe loaded records rather than an unbounded global total. A future backend pagination task can expand this without silently truncating the redesigned list. Legacy profile inventory, specialized photo/report screens and unrelated flows were not redesigned.
