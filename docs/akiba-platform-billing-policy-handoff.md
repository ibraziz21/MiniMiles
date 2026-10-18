# Akiba Platform billing-policy handoff

This is the implementation contract for `Akiba-Platform`, especially
`packages/dashboard-merchant`, `packages/api`, and `supabase/migrations`.
MiniMiles Admin now treats Akiba Platform as the owner of invoice totals,
subscription state, renewal/grace dates, payment rails, and entitlement gates.

## Locked business rules

- Shopper payments never pass through Akiba.
- M-Pesa and bank transfer are used only to pay Akiba merchant subscription
  invoices.
- Public plan prices are exclusive of VAT.
- Basic: KES 500/month, 1,500 Miles issued per usage month, 2 active voucher
  types, 2 branches, KES 0.30 per overage Mile.
- Standard: KES 2,500/month, 10,000 Miles issued per usage month, 5 active
  voucher types, 2 branches, KES 0.30 per overage Mile.
- Growth: KES 5,000/month, 50,000 Miles issued per usage month, 20 active
  voucher types, 2 branches, KES 0.30 per overage Mile.
- Quarterly discount: 5%. Annual discount: 20%.
- Unused included Miles never roll over.
- Overage is invoiced monthly in arrears, including for quarterly and annual
  subscriptions, and is payable with the next billing period.
- Monthly renewal invoices are issued 7 days before renewal.
- Quarterly and annual renewal invoices are issued 14 days before renewal.
- Reminders are sent 3 days before the due date, on the due date, and 3 days
  after the due date. After that, the team follows up directly.
- Every renewal and overage invoice has a 7-calendar-day grace period.
- During grace, service continues.
- After grace, new Miles issuance and new voucher publishing stop. Already
  issued, otherwise-valid vouchers remain redeemable, but their redemption
  must not issue new Miles while the subscription is suspended.
- Payment confirmation restores service immediately.
- Upgrades are immediate after the prorated adjustment invoice is confirmed.
- Downgrades apply at the next renewal.
- Cancellation applies at the end of the paid term; there is no refund for a
  term that has started.

## 1. VAT and invoice totals — required before billing launch

Do not hard-code a tax rate in application code.

1. Add versioned VAT configuration with at least `rate`, `effective_from`,
   `effective_to`, `status`, and audit metadata.
2. Update `compute_subscription_price` and every invoice producer:
   `create_subscription_invoice`, `generate_subscription_renewal_invoice`,
   `close_subscription_usage_period`, and
   `create_subscription_upgrade_adjustment`.
3. Calculate in this order: subtotal, term discount, taxable subtotal, VAT,
   total. Use NUMERIC arithmetic and the existing KES rounding convention.
4. Snapshot the VAT rate/version and `tax_kes` on every invoice. Historical
   invoices must never change when the configured rate changes.
5. Return subtotal, discount, VAT, and total from `/api/billing/quote` and show
   “Prices exclude VAT” on plan cards and checkout.
6. Add `i.tax_kes::text AS tax` to
   `v_admin_subscription_payment_detail` and
   `v_admin_subscription_receipt`.
7. Merchant invoices, merchant receipts, Admin review, and Admin receipts must
   all render the snapshotted tax amount rather than KES 0.

Finance must provide the applicable VAT rate and effective date. Until then,
the UI must not claim that VAT is zero or “not charged.”

## 2. Renewal, overage, grace, and reminders

1. Change `_subscription_grace_deadline` from five Nairobi calendar days to
   seven Nairobi calendar days.
2. Change `generate_subscription_renewal_invoice` so the opening window is:
   - monthly: `next_renewal_at - interval '7 days'`;
   - quarterly/annual: `next_renewal_at - interval '14 days'`.
3. Add a protected, idempotent billing-lifecycle worker, for example
   `/api/internal/billing-lifecycle-worker`, secured by `CRON_SECRET`.
4. Schedule it in `packages/api/vercel.json`. The worker must:
   - generate renewal invoices whose windows have opened;
   - close elapsed monthly usage periods and create one overage invoice when
     required;
   - advance overdue subscriptions through grace and suspension;
   - apply end-of-term cancellation;
   - enqueue each notification exactly once.
5. Use claim/lease or `FOR UPDATE SKIP LOCKED` semantics so overlapping worker
   runs cannot duplicate invoices or notifications.
6. Create a durable billing-notification outbox with idempotency keys for:
   `invoice_issued`, `due_in_3_days`, `due_today`, `overdue_3_days`,
   `subscription_suspended`, `payment_confirmed`, and `payment_rejected`.
7. Implement a worker for that outbox with retry/backoff and terminal failure
   visibility.
8. Persist reminder timestamps and direct-follow-up state. Expose them through
   a service-role Admin projection such as
   `v_admin_subscription_collections_queue`.
9. In `v_admin_subscription_payment_detail`, expose `i.grace_until` directly;
   do not recompute a potentially different deadline in the view.

## 3. Suspension entitlement behavior

Voucher publishing already requires a subscription in `trialing`, `active`, or
`past_due`; preserve that behavior so suspended merchants cannot publish.

Refactor `redeem_kes_voucher_and_award_atomic` because it currently requires an
active/past-due subscription and always calls `award_purchase_reward_v2`.

- For `active` or `past_due`: redeem the voucher and issue the normal Miles.
- For `suspended`: redeem an already-issued valid voucher atomically, record
  the redemption and purchase event, set `miles_awarded = 0` and
  `reward_issued = false`, and do not consume Miles quota.
- For a merchant with no recognized subscription relationship: reject.
- Preserve checkout-attempt idempotency. Retrying the same redemption must
  return the same zero-Miles or awarded-Miles snapshot.
- Do not reactivate archived templates or allow new voucher publishing as part
  of this change.

Add database tests for active, grace/past-due, suspended, duplicate retry,
expired voucher, and wrong-merchant cases.

## 4. Plan changes in `dashboard-merchant`

The backend `/api/billing/plan-changes` route exists, but the Plans tab still
sends every selection to `/api/billing/invoices`, which rejects an active
subscription.

1. Load the current subscription into `BillingPlansTab`.
2. For a merchant without an active subscription, keep the existing initial
   checkout flow.
3. For an active/past-due subscription:
   - a higher plan uses `mode: immediate_upgrade`;
   - a lower plan uses `mode: scheduled`;
   - ordinary term changes use `mode: scheduled` unless product explicitly
     defines them as upgrades.
4. Before confirmation, show the effective date, prorated charge, unused-term
   credit, new plan, and new billing term.
5. After an immediate upgrade, take the merchant to its adjustment invoice.
6. After a scheduled change, show it on Billing Overview with an option to
   reverse it before the renewal invoice is generated.
7. Add UI and route tests proving active subscriptions never call the initial
   invoice endpoint for a plan change.

## 5. End-of-term cancellation

1. Add subscription fields such as `cancel_at_period_end`,
   `cancellation_requested_at`, `cancellation_requested_by`, and an optional
   reason.
2. Add guarded request/revoke-cancellation RPCs with role checks, advisory
   locking, audit events, and idempotency.
3. Add self-service controls to Billing Overview. Confirmation copy must say:
   service continues until the paid term ends, no refund is issued for the
   current term, and the request can be reversed before term end.
4. At term end, set the subscription to `canceled`, prevent renewal-invoice
   generation, stop new Miles issuance and voucher publishing, and preserve
   redemption of already-issued valid vouchers without issuing new Miles.

## 6. Subscription payment rails

1. New payment attempts accept only `bank_transfer` and `mpesa_paybill`.
2. Present NCBA mobile/USSD as instructions for making a bank transfer, not as
   a third payment method.
3. Remove the generic `other` choice from onboarding, `PayModal`, API
   validation, and new database writes.
4. Preserve historical `ncba_mobile` and `other` rows for reporting; do not
   rewrite past evidence or references.
5. Invoice destination snapshots remain authoritative. Never present M-Pesa
   or bank details as merchant payout destinations.

## 7. Remove deprecated merchant commerce and payout functionality

Remove or permanently gate all functionality that assumes Akiba collects a
shopper payment, reimburses a merchant, or settles cUSD/stablecoins. This
includes:

- Hub store checkout and stablecoin settlement-wallet settings;
- merchant order and fulfilment workflows tied to Akiba checkout;
- payout-invoice generation and the old `$20 + 2% GMV` fee model;
- merchant payout destinations, payout receipts, refunds, and reconciliation;
- voucher-program settlement terms and cUSD reimbursement;
- related notifications, crons, analytics, and direct routes.

Preserve purchase/reward events needed to issue Miles and preserve merchant
voucher redemption. Do not remove M-Pesa or bank-transfer instructions from
subscription invoices.

Historical financial records should be retained read-only for audit or exported
before table removal. No deprecated GET route should auto-create a payout row.

## 8. Tests and acceptance criteria

1. Fix `billing_overage.db.test.ts`: Basic includes 1,500 Miles. A useful case
   is issuing 2,000 Miles and asserting 1,500 included plus 500 overage.
2. Add renewal-window tests for monthly 7 days and quarterly/annual 14 days.
3. Add seven-day Nairobi-calendar grace boundary tests.
4. Add worker concurrency/idempotency tests for renewal, usage closure,
   suspension, cancellation, and reminders.
5. Add VAT snapshot tests for initial, renewal, overage, and upgrade invoices.
6. Add payment-method validation and historical-read compatibility tests.
7. Add dashboard tests for initial checkout, immediate upgrade, scheduled
   downgrade, cancellation request/reversal, and suspended voucher redemption.
8. Run the full migration suite from an empty database and against a migrated
   billing fixture before release.

## Definition of done

- Website, merchant dashboard, invoice, receipt, and Admin show the same plan
  and tax totals.
- A cron run alone can generate invoices, close usage, send reminders, and
  suspend/reactivate without manual SQL.
- A suspended merchant cannot issue Miles or publish vouchers but can honor an
  already-issued valid voucher without awarding new Miles.
- An active merchant can upgrade or schedule a downgrade from the UI.
- A merchant can request and reverse end-of-term cancellation.
- Only bank transfer and M-Pesa are offered for subscription payment.
- No reachable Akiba Platform route or dashboard screen represents shopper
  payment collection or merchant payout/settlement.
