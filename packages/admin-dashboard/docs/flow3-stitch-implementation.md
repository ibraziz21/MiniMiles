# Flow 3: merchant publishing and customer preview

Implemented from `f3.zip` on 9 November 2026, extending Flow 2 rather than creating a parallel review system.

## Changes

- `/directory-reviews`: compact, searchable merchant publishing list with All / New profiles / Updates filters. Locations come from actual primary merchant locations. A previous publication timestamp distinguishes an update from a first submission.
- Pending records are queried separately from historical profiles, so a busy published inventory cannot displace pending submissions. The current limits are 500 pending profiles and the latest 100 other profiles, disclosed in the interface where relevant. Location lookups are batched.
- Merchant-list search and filter state survives review, preview, success and back navigation through validated local return URLs. Both the operational queue and dedicated review list are valid return destinations.
- Existing review actions are retained. On mobile, Request changes and Publish stay above the bottom navigation, with additional content clearance. Secondary actions remain expandable.
- `/directory-reviews/[id]?preview=1`: a distinct customer-style rendering with actual cover image where supplied, description, categories, branches, opening hours, public contacts, offerings and supported merchant media. Call, website and map destinations appear only when real data exists. No publishing or moderation controls appear in preview.
- Successful review can open this preview through View profile. Changes requests, notes, confirmation, lifecycle validation and audit logging continue using the existing server API.
- Fixed search handling so literal keywords such as “all” are not mistaken for filter defaults.

## Deliberate adaptations and limitation

The current publication lifecycle stores status history and publication timestamps, not a reliable previous profile payload. The public preview RPC reads current profile fields; the discovery snapshots are a different projection and are not a valid publication baseline. Therefore Current / Submitted field comparisons and specific changed-field summaries from the export have **not** been fabricated. Updates show the submitted profile and explain that the previous version is unavailable. A historical-snapshot capability would be a separate backend change.

The export’s share/save buttons, static map, full-menu control, sample photos and instant-publication guarantees were omitted. The preview uses only existing information and available destinations. Optional `merchantMedia` is supported when returned by the deployed preview RPC; older responses remain usable.

## Verification

- Production build, TypeScript and lint pass.
- 45 unit files / 276 tests pass, including publication-history classification, location/name search, oldest-first ordering and dedicated-list return URLs.
- List, review and customer preview rendered at 320, 375, 414, 768, 1024, 1280 and 1440px without horizontal overflow (21 viewport checks).
- New/Updates filters, literal search keywords, filtered-empty presentation and complete list → review → preview → review → list context restoration verified.
- Fixed action buttons remain clear of mobile navigation. Keyboard focus on secondary review content remains above the action bar.
- Mocked publishing confirms success → View profile navigation and the correct Back to reviews destination. All write requests in browser testing were intercepted; no merchant record was changed.
- 26 shared overview, keyboard and navigation browser tests pass.
- Lighthouse list: performance 100, accessibility 100, best practices 100. Customer preview: accessibility 100, best practices 100. These are local lab checks, not field metrics or a complete WCAG conformance claim.
- Full VoiceOver and native 200% browser-zoom testing remain outstanding, as in previous flows.

Artifacts are local and ignored in `output/playwright/`: `f3-list-375.png`, `f3-review-375.png`, `f3-preview-375.png`, other viewport screenshots and `f3-*-lighthouse.json`. The post-publish browser outcome was mocked, not a real publication.

No schema change, deployment, dependency addition or external notification was made. Existing role checks and server-only no-store data access are preserved. Browser verification continues using the documented Playwright fallback for the unavailable browser skill.
