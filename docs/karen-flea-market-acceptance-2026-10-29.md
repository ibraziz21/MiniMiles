# Karen Flea Market — branch setup and acceptance

29 October 2026. **Configured and published on verification branch `urjamfbtlzycetvuvwpg`; production is unchanged.**

## Event configuration

- Customer title: **Karen Flea Market · 31 Oct–1 Nov** (2026).
- 10% off at Merchant A, B or C, represented by the three existing `Verification Merchant A/B/C` profiles.
- Maximum discount **KES 200**; minimum purchase **KES 300**; one voucher used once at any participating vendor.
- Claiming is open now; the claim deadline is **1 November, 23:59 Africa/Nairobi**.
- Redemption is restricted to **31 October–1 November 2026, inclusive, in Africa/Nairobi**. Later weekends are excluded.
- Rolling validity is at most seven days and is capped at **1 November, 23:59:59.999 EAT**. The claimed event voucher has exactly that expiry.
- Event quantity: **10**, retaining the synthetic setup's quantity. One real web claim was made by synthetic member 2; **9 remain**. The other pre-existing synthetic users/vouchers were preserved.
- Existing Pass activation and mandatory Kenya profile-country eligibility are enabled.

Branch identifiers:

| Object | ID |
| --- | --- |
| Fund | `3144bf0e-035a-4c7c-8b33-fda1c0d118e4` |
| Event allocation | `93cd6269-0e16-4c9f-b5a6-1d44dd4244a7` |
| Event template | `9c5674bb-43af-447f-8ca3-e2837163d347` |
| Claimed event voucher | `94eaf268-ca74-4c05-ac93-a302fb7f4721` |
| Rehearsal allocation | `4c11a7c3-e7de-4c89-9e0c-91bc114830d2` |
| Rehearsal voucher | `ccd28b9e-32d9-4f8a-88ae-a8363d74bf45` |

The synthetic fund's KES 2,200 ceiling comprises KES 2,000 for the ten event vouchers and KES 200 for one clearly labelled acceptance rehearsal. This is test configuration, not a production budget authorization.

## Complete acceptance journey

The admin, Hub and merchant journeys used production builds connected only to the branch. Open-access admin mode was disabled. The existing synthetic Ops and Finance identities were provisioned as authenticated dashboard users; the Ops creator and Finance approver are distinct. Their fund approval and all six allocation submit/approve/publish audit records were independently checked in the database.

1. Created the fund in the admin UI; Ops submitted, Finance independently approved, and Ops published.
2. Created Karen's offer in the UI with all three selected vendors. Verified the persisted membership, draft date round-trip and exact event policy. A stale edit returned **409** without persisting its marker. Submitted, independently approved and published. The final page shows **three Ready vendors**. Secondary merchant B’s public page also returns HTTP 200 and includes Karen’s offer.
3. Synthetic member 2 checked eligibility and confirmed a real web claim. The confirmation showed the full merchant scope, cap, minimum, claim deadline and exact redemption dates. The issued snapshot contains all three IDs and the immutable event dates.
4. Decoded the actual rendered QR and presented it at merchant B. Inspection recognized the voucher and its conditions. An attempted checkout **today**, even with a caller-supplied event-day `occurred_at`, returned **409 / `REDEMPTION_DAY_NOT_ALLOWED`**. The event voucher remains issued, with no redemption committed.
5. Used a separate **Karen Flea Market · acceptance rehearsal**, limited to one voucher and today only, to exercise successful checkout without changing the event's dates. It has the same three vendors, percentage, cap, minimum and country/Pass eligibility, but a different date window. Its single claim consumes the stock, so it is no longer claimable.
6. At merchant B, redeemed the rehearsal's rendered QR against receipt **`KAREN-REHEARSAL-B-001`**: KES 1,000 gross, KES 100 discount, KES 900 net and **9 Miles**. Replaying the identical request returned the same redemption and purchase IDs with `idempotent: true`.
7. Independently queried committed records: exactly one redemption, purchase, Miles entry and 10,000-minor-unit (KES 100) payable, all attributed to **B**, with none of those obligations on primary A. Funding ledger: **+20,000 reservation / −20,000 release / +10,000 realised**.
8. Merchant B's production-build statement and full CSV contain the new receipt once. B's total outstanding is now KES 200: KES 100 from the older verification redemption plus KES 100 from this rehearsal. A and C remain at zero. No settlement batch or payment transfer was made.

This does **not** claim that the future event was successfully redeemed today. Its actual early refusal was checked; positive date-boundary cases were exercised in disposable PostgreSQL, and the successful browser checkout used the clearly identified rehearsal.

## Defects found and repaired by the journey

- **Participant selections were discarded.** Both admin create/edit routes parsed additional merchant IDs but omitted them from the atomic RPC. Both now forward the intended set, including independent replacement, explicit clearing and omission/preservation behavior. The unpublished draft was repaired through the corrected UI before any claim; the next allocation's create path persisted all vendors directly. Route regression tests assert the actual RPC arguments.
- **Allocation reads became ambiguous.** PostgREST saw both the primary relationship and the new participant relationship. Admin allocation reads now specify the primary foreign key explicitly. Lookup errors are no longer disguised as a missing allocation, and a failed membership lookup withholds the editor rather than shrinking its set.
- **Draft edits shifted claim times.** UTC ISO values had been sliced into Nairobi-labelled inputs and reinterpreted as local time. Fund/allocation forms now round-trip explicitly through Nairobi time independently of browser timezone, with regression tests.
- **Weekdays could not express the requested event dates.** MiniMiles migration **114** extends the existing immutable schedule with optional validated local start/end dates, enforces them on the server clock and caps issuance expiry. Customer entitlement screens show those dates. Existing weekday-only policies retain their behavior.

## Verification and rollout

- Admin unit suite: **257 passed**.
- Hub unit suite: **1,128 passed, one skipped**.
- Full integration replay: **494 passed, five skipped**, including **123 funded tests** (37 multi-merchant, 38 percentage/weekend, 48 accounting).
- Admin and Hub typechecks and production builds passed.
- Event-date form inspected at 320, 375, 414, 768, 1024, 1280 and 1440 CSS pixels: no horizontal overflow; date input accessible by its label and focusable by keyboard.
- Public card, published admin readiness page and merchant statement were inspected/captured. The isolated admin harness was corrected to include its real PostCSS configuration and rebuilt into a fresh output directory; the final styled checks confirmed the Inter font and canvas theme before measuring layouts. Temporary QR images were deleted after decoding; raw presentation tokens and passwords are excluded from this report.

Migration 114 is applied **only on the branch** and included in the replay manifest. Apply it before exposing event-date authoring in production: the older weekday validator does not enforce these additional dates. Keep its enforcement when rolling application code back; do not downgrade the date functions after issuing bounded event vouchers. Earlier Platform/MiniMiles migration dependencies and production object state still need the coordinated rollout checks.

The pre-existing branch Merchant Terms status RPC warning remains outside this acceptance path; no merchant terms were accepted or legal/content-publication workflow certified here. Production settings, TLS/camera behavior, external deliveries and actual payment transfers are not certified by local browser journeys. Production deployment and production smoke checks remain rollout work.

Evidence is under ignored `.verification/karen-*`, including migration receipt, admin lifecycle, customer confirmations, early-refusal/checkout responses, independent accounting, statement/CSV and test/build logs. Screenshots: `output/playwright/karen-offer-card.png`, `karen-admin-published.png`, `karen-merchant-b-statement.png`.
