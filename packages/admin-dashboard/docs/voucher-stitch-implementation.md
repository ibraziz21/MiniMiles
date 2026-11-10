# Voucher oversight — Stitch implementation

Source: `/Users/ibraziz21/Downloads/voucherflow.zip`.

Implemented the three supplied compositions: the voucher catalogue, offer detail, and issued-voucher detail. A compact paginated issued register connects the latter two. The lavender canvas, white cards, teal controls, model icons, merchant cover, distribution pool, specification rows, code-copy panel and activity timeline follow the supplied screens. The shared voucher navigation icon is now a ticket.

## Routes and behaviour

- `/vouchers`: reporting period, current active-offer count, actual issued/redemption totals, merchant/title/code search, All/Free/Miles/Reimbursable filters, active offers first and pagination. Reporting periods use midnight EAT; activity totals use their actual issuance/redemption timestamps. Active offers are the current count, independent of the reporting period.
- `/vouchers/[id]`: uploaded merchant cover, actual offer description/status, issued/redemption counts, authoritative program or allocation availability when available, benefit/cost/validity/eligibility/claim limits, issued-register link and expandable details. Unknown remaining inventory is labelled rather than calculated from an unreliable historical count. Funded eligibility and claim lifespan come from the existing allocation/rule-set records.
- `/vouchers/issued`: retains fund, allocation, merchant, status and recipient filtering; adds template/code/title/member search and individual detail links. Current member lookup is preserved with claim-time username fallback. Pagination and return URLs preserve the catalogue/offer journey.
- `/vouchers/issued/[id]`: actual code with clipboard feedback, member username, recorded dates and timestamp-based activity history. No SMS dispatch event is invented. Existing funded revocation API is retained, with verified reason, authorization checkbox and confirmation. Redeemed/non-issued records, unsupported voucher models, insufficient roles and production open-access sessions cannot use the control.

Only merchant KES-compatible templates are included. Legacy dollar-valued templates are excluded. Issued lists include issued/redeemed/expired/revoked records; aborted/void attempts do not appear as issued vouchers. Reimbursable funding remains distinct even when an offer also has a Miles acquisition price.

Fund/allocation management, issuance, pricing, programs and referral tools remain linked under Voucher tools with their existing permissions. The funded setup/issuance/reimbursement screens remain separate flows for their own ZIPs. No schema or financial API was changed, and no live voucher was issued or revoked.

## Verification

Production build and 285 unit tests pass, including new model, lifecycle, EAT reporting-window, duration and safe-return-path tests. The 26 shared browser regressions pass. The complete catalogue → offer → issued register → issued detail → back journey retains search, model and reporting-period state. Clipboard copy and the named-admin disabled state were checked in the browser. Four surfaces fit 320, 375, 414, 768, 1024, 1280 and 1440px (28 viewport checks), and merchant image decoding was verified.

Local Lighthouse: catalogue 93 performance / 100 accessibility / 100 best practices; offer detail 94 / 100 / 100. Screenshots and audit JSON are under ignored `output/playwright/`. Browser checks did not send financial mutations; the existing revocation route tests exercise its API rules. Native 200% zoom and VoiceOver were not verified.
