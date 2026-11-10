# Reimbursements and subscription payments

Reference: `/Users/ibraziz21/Downloads/reimbursements&Voucherpayments.zip`.

Both flows use the shared lavender canvas, compact white cards, teal actions and account header. Reimbursements now opens with an outstanding balance, merchant search and status filters, then merchant-specific payment runs, payables and summary. Existing batch creation/submission/cancellation and exact-amount payment recording remain supported, with a synchronous request lock. Incidents remain available. Subscription review has concise payment facts, risk flags, evidence/decision controls and collapsed invoice/subscription metadata. Queue advanced filters are collapsed; mobile cards compare submitted and expected amounts. Collections has search and an outstanding invoice balance. Collection query failures show an unavailable state.

Business logic remains in existing server APIs. Reviewer ownership/takeover, expected versions, confirmation checklist, KES verification, exact balance checks, evidence notes, rejection codes/messages and receipt links remain intact. No database migration or real financial mutation was performed.

The ZIP contains capabilities absent from the reimbursement dashboard API: receipt uploads, payment rail/date selection, batch redemption evidence and payout account details. Existing evidence-reference entry is used instead. No fabricated till number, payment schedule, verified receipt, excluded-redemption count, SMS or payment dispatch is displayed. Reimbursement detail is a merchant drill-down in the existing page, with payment forms in the payment run, rather than new unsupported routes. Subscription completed history uses actual confirmed/rejected states; acceptance refreshes the authoritative detail instead of inventing a receipt outcome.

Validation: production build, typecheck and 288 unit tests pass. Five populated fixture surfaces were checked at 320, 375, 414, 768, 1024, 1280 and 1440px. Intercepted payment recording verifies exact total payload and visible server-conflict feedback. No live payment was recorded. Native 200% zoom and VoiceOver were not verified. Fixtures, screenshots and repeatable journey are in ignored `output/playwright/`.

Final populated payment journey passes after spacing corrections. Local subscription queue Lighthouse scores: performance 94, accessibility 100, best practices 100.
