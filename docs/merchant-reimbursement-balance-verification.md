# Merchant reimbursement balance verification

Verified 29 October 2026 (Africa/Nairobi). Preview uses Supabase branch `urjamfbtlzycetvuvwpg`; production was not modified.

## Merchant experience

- Home shows **Akiba owes you**, with a direct link to `/reimbursements`.
- The direct page works independently of `NEXT_PUBLIC_BILLING_V2_ENABLED`. The existing reimbursement tab under Billing reuses the same component.
- Outstanding includes pending and submitted-for-payment amounts. **In payment** is explicitly a subset of outstanding, not an additional amount.
- **Paid to date** sums actual paid batch items; subsequent payable reversals do not erase cash payment history. Outstanding uses the remaining net payable, including adjustments/reversals.
- The statement retains receipt, redemption date, current reimbursement status, payment reference, paid date, and CSV export.
- A failed HTTP request or unreadable statement produces an unavailable message and retry button. It does not show zero or an empty statement.

## Data and migrations

Platform `158_merchant_reimbursement_balances.sql` excludes cancelled batch memberships before joining the statement, preventing duplicate redemption rows after cancellation/re-batching. It adds a service-role-only, merchant-scoped JSON statement RPC. One query snapshot provides the complete statement without the PostgREST row cap truncating balances or CSV exports.

Platform `159_merchant_reimbursement_paid_totals.sql` preserves actual paid cash totals independently of the current net payable. This is a forward migration because 158 had already been applied to the verification branch during implementation.

Both migrations preserve existing view/function grants and dependencies; RPC execution is explicitly denied to anon and authenticated roles. The dashboard API derives the merchant solely from its authenticated session, ignores caller-supplied merchant IDs, and sends `Cache-Control: no-store, private`.

Branch migration receipts (private, ignored local artifacts):

| Migration | Branch version |
| --- | --- |
| Platform 158 | `20261029073815` |
| Platform 159 | `20261029075844` |

Apply the two forward migrations before deploying the updated merchant API. On a missing/unavailable RPC, the API returns 503 rather than falling back to an incomplete statement. Production migration-order reconciliation remains a separate requirement.

## Evidence

Real verification-branch statements:

| Merchant | Statement rows | Outstanding | In payment | Paid |
| --- | ---: | ---: | ---: | ---: |
| Verification Merchant A | 0 | KES 0 | KES 0 | KES 0 |
| Verification Merchant B | 1 | KES 100 | KES 0 | KES 0 |
| Verification Merchant C | 0 | KES 0 | KES 0 | KES 0 |

B's receipt is `VERIFY-B-001`, from the earlier genuine synthetic voucher checkout. Browser verification confirmed that adding A's merchant ID to B's API query cannot change B's statement.

- 18 focused merchant tests passed: exact minor-unit totals, in-payment subset, paid/reversed separation, partial reversal, post-payment cash history, empty success, invalid money/status/duplicate failures, session scoping, no-session rejection, database failure, statement over 1,000 rows, HTTP errors and malformed successes.
- 10 accounting integration tests passed against the bounded migration replay and real Miles award chain. Two added regressions exercise cancelled/re-batched/submitted/paid/reversed statement rows and RPC grants. The cancellation/payment/reversal fixture runs inside a rolled-back transaction; it initiates no external payment.
- Merchant TypeScript check passed (`tsc --noEmit --incremental false`). Diff whitespace checks passed in both repositories.
- Browser checked at 1440px and 375px: correct B balance, receipt, CSV download, no horizontal overflow at 375px, simulated 503 with no false zero/empty state, successful retry, Home balance and direct-page link. No page JavaScript errors occurred during this verification. The CSV contains one KES100 pending reimbursement.

Local screenshot evidence is under `output/playwright/`: `reimbursements-desktop.png`, `reimbursements-mobile.png`, `reimbursements-error-mobile.png`, and `reimbursement-home-mobile.png`. Sanitized check results are under ignored `.verification/reimbursement-*-result.json`; generated statement under ignored `output/verification/merchant-b-reimbursements.csv`.

## Limits

The separate Merchant Terms acceptance request still returns 503 in this preview because migration 153 remains pending its own review. Its banner is visible and was not suppressed or accepted during these checks. Intentional HTTP failures and that existing terms failure appear in the browser console; the page-error check above refers to JavaScript runtime errors.

The statement is currently returned as one complete response, preserving the existing full-statement/download behavior. Large-history pagination and separate streamed exports remain a scaling improvement; no production-volume benchmark was performed.

This work adds visibility, not payout execution or a promised payment date. No production deploy, payment transfer, or change to the remaining multi-merchant launch blockers was made.
