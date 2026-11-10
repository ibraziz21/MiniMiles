# Members, deletions and notifications

Reference: `/Users/ibraziz21/Downloads/members-deletion-notification.zip`.

Members has compact identity rows, username/ID/phone search within the latest 100 records and a new permission-checked `/users/[id]` detail. Actual phone/join data is shown. Existing risk flags remain in the list. The current `akiba_users` directory source does not expose authoritative Miles balances, activity, email, suspension or a canonical deletion-request mapping; those values and filters were not fabricated. A dedicated core member support data source is still needed to reproduce every detail in the mockup.

Deletion queue/detail now use the shared lavender canvas, white cards, teal account header and collapsed request/delivery metadata. Existing pagination, overdue/error indicators, audit history, assignment, preflight/blockers, operator permissions, execution leases, exact typed confirmation and completion-email retry remain intact. A synchronous request lock prevents duplicate action submission. No claims of pre-cleared checks, automatic balance settlement, cooling-off policy or completed erasure were added. No cleanup was run.

Notifications uses compact searchable campaign rows, detail statistics, separate compose/review/queued outcomes, a light preview and mobile controls. Existing validation (60-character title, 160-character body, relative destination), permission checks and idempotency survive; a synchronous lock prevents duplicate sends. Failed retries retain their key. The UI says queued and provider accepted rather than claiming device delivery. The existing service targets opted-in PWA users only; native app broadcast, regional/merchant segments, durable drafts and scheduling are not available from this API. Detail/history currently covers the latest 50 campaigns. No live notification was sent.

Validation: production build, typecheck and 288 unit tests pass. Nine populated fixture surfaces pass at 320, 375, 414, 768, 1024, 1280 and 1440px. An intercepted notification send exercises error feedback, key-preserving retry and queued confirmation. No actual notification or deletion mutation occurred. Native browser zoom and VoiceOver were not verified. Fixtures, screenshots and repeatable journeys are in ignored `output/playwright/`.

Final verification: 26 shared navigation/keyboard tests pass. Local notification composer Lighthouse: performance 100, accessibility 100, best practices 100.
