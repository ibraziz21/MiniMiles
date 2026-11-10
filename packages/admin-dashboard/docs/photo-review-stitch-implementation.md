# Photo reviews — Stitch implementation

Source: `/Users/ibraziz21/Downloads/photoreview.zip`.

Queue photo and report rows now open the selected record and retain the queue's search, filters and sort in the return link. Photo reviews has searchable, paginated Pending and Reviewed lists, with a link to Reported content.

Photo detail shows the actual merchant, submission time, status and signed image preview. Images open at full size in a separate tab; unavailable previews can request a new signed link. Approval requires confirmation. Rejection requires an existing supported reason. Previously approved photos retain the existing hide/restore controls.

Report detail shows the recorded reason and available public visit content. Private feedback is not used as public review text. Additional state and resolution information is expandable. Existing dismiss, hide photo and hide visit actions are retained behind permission and named-admin checks. No payment, geofence, reporter explanation or audit claims are invented.

Existing moderation APIs, validation, audit rules and signed URL expiry are unchanged. The ZIP's internal-note fields were omitted because the existing photo decision API does not support them. No schema changes, deployment or live moderation decisions were made.

Validation: 278 unit tests and 26 shared browser tests passed; production build passed. Photo list, photo detail and report detail fit 320, 375, 414, 768, 1024, 1280 and 1440px with no horizontal overflow. Pending photo/report layouts and photo confirmation dialogs were checked against an isolated local fixture service. Report writes were not exercised through open-access mode, which does not provide a named admin. Keyboard focus returns to the photo decision trigger when its dialog closes.

Local fixture photo-list Lighthouse scores: performance 94, accessibility 100, best practices 100. Artifacts are in ignored `output/playwright/`. Fixtures are test-only and not application data. Native 200% browser zoom and VoiceOver remain unverified.
