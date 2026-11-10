# Merchant administration — Stitch implementation

Source: `/Users/ibraziz21/Downloads/merchantadmin.zip`.

The directory uses compact rows, real primary locations and independent publication/subscription statuses. Search and All, Published, Changes requested, Trial and Archived filters persist in the URL and survive opening a merchant. Reads paginate through the data source instead of silently stopping at its default row limit. Failed reads display an error rather than an empty directory.

Merchant detail has a compact identity/status section, actual billing-period Miles usage and links to Public profile, Vouchers, Subscription, Notes & history and Team. Separate URL-backed sections replace the crowded tab bar. Profile review/preview navigation returns to the merchant section and preserves directory filters. Existing team and voucher information is retained.

Subscription shows existing plan, billing term, renewal/trial end, Miles allowance and overage. Finance-authorized users can open payment reviews/history filtered to the merchant. The export's unsupported invoice downloads, terminal counts, voucher plan caps and paid-plan extensions are omitted. Trial setup uses a mobile sheet with the existing 2-day default, 14/30-day presets and a 1–30-day custom duration. Existing paid-subscription restrictions remain. No unsupported trial-reason field is submitted.

Archive is under Manage merchant, with reason presets, editable reason and the existing typed-name confirmation. The dialog accurately states that archiving hides discovery but does not stop subscription billing. Existing APIs and server authorization are unchanged. No live trial, archive or note actions were performed.

## Outstanding database dependency

The connected database does not have `public.merchant_admin_notes`. The existing table definition is in `sql/005_risk_flags.sql` (lines 31–39). Staff notes therefore show an unavailable state and cannot be submitted there; actual profile decisions remain available. Notes UI and the existing endpoint were tested with isolated local fixtures and intercepted responses. Notes should not be considered operationally complete until the existing schema is installed and verified in the intended environment. No database schema was changed in this UI task.

Notes load authors separately, avoiding reliance on an unavailable PostgREST relationship. When notes are available, Notes & history combines staff notes and the latest 50 profile decisions chronologically, with All/Notes/Actions filters and a labelled staff-only note form.

## Verification

- Production build and 280 unit tests pass, including filtered return-path validation.
- 26 shared responsive/keyboard browser tests pass.
- Directory and six merchant sections fit 320, 375, 414, 768, 1024, 1280 and 1440px (49 viewport checks). Trial/archive sheets fit the same seven widths (14 checks).
- Browser checks cover directory return state, empty search, paid-trial disabled state, unavailable notes, dialog focus restoration, required archive name, and trial/note/archive request bodies and success/error states. All action requests were intercepted against isolated read-only fixtures.
- Local Lighthouse: directory 100 performance / 100 accessibility / 100 best practices; detail 98 / 100 / 100.
- Screenshots, fixture scripts and audit JSON are under ignored `output/playwright/`. Fixture screenshots are explicitly named as fixtures. Native 200% zoom and VoiceOver were not verified.

No schema changes, production record mutations, dependency updates or deployment.

## Visual correction after user review

The first pass was too generic and omitted existing profile media. It has been corrected to follow the ZIP's composition: lavender canvas and inset surfaces, branded header/account menu, actual thumbnail images, a cover-led merchant detail card with category overlay, status pills, icon navigation rows, subscription hierarchy, notes/history timeline and identity cards in trial/archive sheets. Archive reasons use radio rows; the existing typed-name safeguard remains.

Directory images now use `partners.banner_url`, `image_url` or `logo_url`. Detail uses actual `preview_merchant_directory` logo/banner/gallery data, with partner media fallbacks. Arabica's saved banner currently contains its logo; its uploaded offer image is shown on Public profile. No stock photos from the Stitch sample were attached to real merchants.

Verified actual image decoding, all seven widths for directory/six sections and both sheets, read-only sheet interaction and dismissal. Production build, 280 unit tests and 26 shared browser tests pass after the correction. Corrected detail Lighthouse scores: performance 95, accessibility 100, best practices 100. Updated screenshots are named `merchant-*-corrected.png` in ignored `output/playwright/`. The missing staff-notes table remains the same outstanding dependency.
