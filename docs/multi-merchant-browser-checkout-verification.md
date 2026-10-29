# Multi-merchant voucher preview and checkout verification

Date: 2026-10-29 (Africa/Nairobi)
Environment: Supabase verification branch `urjamfbtlzycetvuvwpg` with the
restored main application schema. Production was not modified.

## Local previews

- Hub: <http://127.0.0.1:4103/vouchers>
- Merchant till: <http://localhost:4104/login>
- Platform API: <http://127.0.0.1:4199>

The previews use process-level branch credentials and synthetic signing
secrets. Existing application environment files were not edited. Merchant and
API preview copies/builds live under the private `.verification/` directory;
the Hub uses `.next-verification`. Synthetic account passwords are in
`.verification/synthetic-fixture-private.json`, never in this report.

## Browser checks performed

| Check | Result |
|---|---|
| Member password sign-in | Passed through the Hub UI |
| Merchant B staff password sign-in | Passed through the merchant UI |
| Pre-claim participant disclosure | A, B and C all visible and linked |
| Secondary merchant discovery | B's own public page shows the same allocation |
| Keyboard disclosure | Enter expands the native disclosure and exposes all three merchants |
| Owned voucher | All three snapshot merchants above the QR action |
| Mobile layout | 375px viewport; participant list fits without horizontal overflow |
| Actual QR presentation | Real member UI QR decoded in memory and supplied through the till's paste-code path |
| Merchant B checkout | KES 1,000 bill, KES 100 discount, KES 900 net, 9 Miles |
| Exact checkout replay | Same redemption/purchase IDs; `idempotent: true` |
| Redeemed web history/detail | Actual redeemer B, issued title retained, readable source label |
| Redeemed detail usability | No Show QR action; explicitly says redeemed |

The QR handoff exercised the actual generated QR payload, manual-code entry,
inspection, bill/receipt entry and confirmation. Physical camera capture was
not tested. The final clean redeemed-detail load recorded no browser page
errors. Screenshots are private local artifacts under `output/playwright/`.

## Committed accounting checked read-only

- Voucher: `ba1dac2c-d0dd-441a-a1d1-ab99b33bf7c2` (member 1).
- Redeeming merchant B: `f0432f7c-612e-4c25-b508-f0e0563375e1`.
- Redemption: `e68358a8-8b21-4c89-a562-c79f6f86a43a`.
- Purchase: `a08a1cf2-f9d2-4699-930a-86a36de16abe`.
- Checkout attempt: `8677885f-31ec-4361-9e10-b62dbed84f22`.
- Exactly one redemption, purchase, Miles credit and payable, all attributed to B.
- The 9-Mile credit belongs to member 1's canonical identity
  `1187b168-78c9-484d-93c1-5d8c3e794a4b`, not the merchant staff account.
- Payable: 10,000 minor units (KES 100).
- Funding ledger: reservation created +20,000; reservation released -20,000;
  redemption realized +10,000. Exactly one of each for this voucher.
- Members 2 and 3 retain their original issued, unspent vouchers.

No real payment or payout occurred. Payout destinations remain unset on these
synthetic merchants.

## Older-client checks performed against the running preview

With both compatibility flags off:

- Redeemed list and detail return 200 and identify B.
- Member 2's usable multi-merchant voucher is omitted from the legacy list.
- Its legacy detail returns 409 `VOUCHER_NOT_SUPPORTED`.
- Direct legacy claim returns 409 `OFFER_NOT_SUPPORTED` before issuance.

## Defects found and corrected during verification

1. The new merchant relation made PostgREST's primary-partner embed ambiguous.
   Both funded discovery loaders now name the allocation's merchant FK.
2. Main's template `linked_product_id` column is TEXT, whereas a fresh Platform
   replay uses UUID. Both inspect and redeem could fail at runtime on mixed
   COALESCE types, even for null IDs. Forward Platform migration
   `157_kes_voucher_legacy_product_id_compatibility.sql` normalizes the fallback
   explicitly. Applied only to the verification branch, recorded as version
   `20261028210424`. A new integration case exercises inspection and redemption
   with the TEXT column; the existing cases continue to exercise UUID.
3. The web wallet uses `/api/shop/vouchers/my`, a separate serializer from v1.
   That path and web detail now resolve the actual redemption merchant. The
   wallet also selects/preserves the title and exposes the snapshot participant
   count, avoiding a blank heading and primary-only usable-voucher copy.
4. The offline service worker cached old development chunks and caused stale
   client code/hydration errors after edits. Registration now skips development.
   Existing workers/caches were cleared only in the verification browser
   contexts. Production offline registration is unchanged.

## Automated checks

- 56 focused Hub unit tests passed across mapping, owned vouchers, detail,
  legacy compatibility and the new web-history regression tests.
- 8 accounting integration tests passed on the disposable local replay,
  including the legacy TEXT product-ID regression.
- Hub TypeScript check and whitespace check passed.

The local concurrency, schedule rollback and outside-merchant tests are local
replay evidence; this run does not relabel them as browser or branch executions.
Detailed branch responses and financial assertions are in
`.verification/browser-checkout-result.json` and
`.verification/checkout-accounting-result.json`.

## Remaining acceptance work

- The current merchant preview includes a Merchant Terms panel, but the
  unrelated pending Platform 153 terms migration was not applied. Its status
  endpoint returns 503 and the panel displays an unavailable/pending notice.
  This must be reconciled with the merchant app's eventual deployment scope.
- Incomplete-profile warnings have regression coverage but were not rendered
  against a deliberately unresolved real profile in this browser run. Archiving
  a merchant does not necessarily produce that state: issued-voucher lookup
  intentionally retains inactive participants.
- Admin UI publication/stale-edit acceptance, branch concurrency and disallowed-
  day checks, physical camera scanning, broader responsive/accessibility checks,
  and controlled production promotion are not completed by this run.
- Migration version mapping and baseline deployment must be reviewed before any
  branch/main merge. Historical production apply order is still unverified.

The branch remains available for testing. Remove the temporary branch and its
preview credentials when the feature's verification/release work is complete.

## Follow-up: merchant reimbursement visibility

The merchant balance and statement were subsequently verified against this checkout’s KES100 payable. See [merchant reimbursement verification](merchant-reimbursement-balance-verification.md) for the implementation, migrations 158–159, browser checks, and limits.
