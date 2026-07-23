# Spec: Persistent Paid-Order Recovery

**Package:** `packages/hub-page`  
**Status:** Proposed  
**Priority:** Launch blocker for M-Pesa and crypto checkout

---

## Context

Payment confirmation is durable, but the checkout intent is not. The M-Pesa
request and callback survive a reload in Supabase, while product, voucher,
recipient, and delivery details remain in `CartDrawer` React state. If the user
leaves the page after payment but before order creation, the Hub cannot safely
reconstruct the order.

The recovery path must never initiate a second payment. A confirmed payment
must either create exactly one order or remain visible as a recoverable
incident until a user or operator resolves it.

## Locked decisions

- Supabase is the source of truth for pending and recoverable checkouts.
- `localStorage` or `sessionStorage` may improve UX, but is never authoritative.
- Recovery reuses the original payment reference and never sends another STK
  prompt or wallet transaction.
- Order creation remains idempotent through the unique `payment_ref`.
- Successful callbacks remain recoverable after the STK request expiry time.
- Product and price are revalidated server-side during recovery.
- Legacy payments without a stored checkout snapshot require user/operator
  confirmation; the system must not guess recipient or fulfillment details.

## Target lifecycle

```text
checkout_created
        |
        v
payment_pending -----> payment_failed
        |
        v
payment_confirmed
        |
        v
order_pending_recovery
        |
        +-----> order_created
        |
        +-----> reconciliation_required
```

`payment_confirmed` and every state after it are paid states. No UI action from
those states may call `/api/payments/mpesa/initiate` or request a crypto
transfer.

## Phase 0 — Stabilize the current flow

**Status:** Implemented in code; requires migration/deployment verification.

- Apply `supabase/migrations/031_hub_order_legacy_columns.sql`.
- Populate required legacy `merchant_transactions` fields.
- Map M-Pesa to the legacy `payment_method = other` enum and crypto to
  `onchain_transfer`; retain the real provider in server metadata and
  `payment_currency`.
- Return `payment_received: true` and `recoverable: true` after a verified
  payment when order creation fails.
- In the same browser session, show **Finish order**, not **Try again**.
- Deduplicate open reconciliation incidents by payment reference.
- Log the exact database error without exposing it in user-facing copy.

### Phase 0 gate

- The existing confirmed test payment creates one order through **Finish
  order**, with no new STK prompt.
- Repeated recovery returns the same order and creates no duplicate order or
  duplicate open incident.

## Phase 1 — Persist the server-owned checkout intent

Add a forward migration, expected as `032_persistent_checkout_recovery.sql`.

Extend `mpesa_stk_requests` or introduce a dedicated `hub_checkout_intents`
table with:

- `id`
- `hub_user_id`
- `checkout_request_id`
- `state`
- `product_id`
- `voucher_id`
- `recipient_name`
- `recipient_phone`
- `city`
- `location_details`
- `expected_amount_kes`
- `pricing_snapshot`
- `order_id`
- `last_error`
- `created_at`, `updated_at`, `completed_at`

Sensitive fulfillment fields must remain service-role-only. Do not expose them
through anon/authenticated table policies.

Change `/api/payments/mpesa/initiate` to accept the intended product, voucher,
and fulfillment fields—not a client-authoritative amount. The server must:

1. Authenticate the Hub user.
2. Load the active product and merchant.
3. Validate voucher ownership and scope.
4. Calculate the expected total.
5. Store the validated checkout intent.
6. Initiate STK using the server-calculated KES amount.
7. Attach the returned checkout request ID to the intent.

The existing `amount_usd` and `merchant_name` values from the browser must no
longer be trusted for payment initiation.

### Phase 1 gate

- Reloading immediately after accepting the STK prompt does not lose product,
  recipient, voucher, or delivery details.
- A forged browser amount cannot alter the STK amount.
- Checkout intent rows are only readable through authenticated server routes.

## Phase 2 — Add authenticated self-service recovery

Add:

- `GET /api/shop/orders/recoverable`
- `POST /api/shop/orders/recover`

`GET /recoverable` returns the current user's successful, unmatched payments
with a sanitized order summary. It joins checkout intent, callback result, and
`merchant_transactions` by payment reference.

`POST /recover` accepts only the checkout intent or checkout request ID. It
must load all order fields from the server snapshot, revalidate product and
voucher rules, verify the recorded callback or on-chain transfer, and call the
same atomic order-placement service used by normal checkout.

Both normal creation and recovery must:

- Acquire a payment-reference lock or rely on an atomic unique constraint.
- Return the existing order as success when `payment_ref` was already used.
- Never initiate payment.
- Preserve the reconciliation incident if recovery still fails.
- Resolve the incident automatically after successful order creation.

### Phase 2 gate

- Recovery works after refresh, browser close/reopen, logout/login, and on a
  second device for the same authenticated account.
- Two concurrent recovery calls return one order.
- Recovery of another user's checkout ID returns `404` or `403`.

## Phase 3 — Surface recovery in the member UX

- Query recoverable payments on Member Home and `/me/orders`.
- Show a persistent banner: **Payment confirmed — finish your order**.
- Open a recovery summary showing product, amount, payment time, and
  fulfillment destination.
- Primary CTA: **Finish order**.
- Secondary CTA: **Contact support**.
- Never show **Pay**, **Send M-Pesa prompt**, or **Try again** for a confirmed
  payment.
- Clear cart and local pending-checkout hints only after an order exists.

For legacy payments without a complete snapshot, show **Complete order
details** and collect only the missing fields before recovery.

### Phase 3 gate

- A user can leave during every checkout stage and sees the correct state on
  return.
- The UI clearly distinguishes payment pending, payment failed, payment
  confirmed, and order created.

## Phase 4 — Admin reconciliation

Add an admin-dashboard queue backed by `reconciliation_incidents`:

- Payment reference and provider receipt
- User and merchant
- Product and amount
- Exact internal error
- Snapshot completeness
- Age and retry count
- Linked order, when resolved

Actions:

- Retry order creation
- Request missing fulfillment details
- Mark resolved with an audit note
- Record reversal/refund reference

Every action must be audited. Operators must not manually insert a completed
order without re-running payment, ownership, amount, and idempotency checks.

### Phase 4 gate

- Every confirmed payment without an order appears in the queue.
- Retrying from admin and user surfaces uses the same recovery service.
- Resolution preserves a trace from payment to incident to order or reversal.

## Phase 5 — Production hardening

- Alert when a successful payment has no order after five minutes.
- Track `payment_confirmed_to_order_created` latency and recovery success rate.
- Add scheduled reconciliation for stuck confirmed payments.
- Add retention rules for abandoned checkout PII.
- Verify production callback authentication and provider separation.
- Add failure tests for callback delay, app reload, database outage, duplicate
  callback, duplicate recovery, voucher race, and reward-service outage.
- Keep sandbox and production credentials, shortcode, callback URL, and data
  visibly separated in operational tooling.

## Acceptance criteria

- No confirmed payment can be followed by an action that silently charges
  again.
- A confirmed payment is recoverable after leaving the page.
- Exactly one order exists per payment reference.
- Recovery never trusts browser-supplied price or payment success.
- Missing legacy checkout details are requested, not inferred.
- Users and operators see the same underlying recovery state.
- Reconciliation incidents close automatically when an order is created.

## Rollout order

1. Apply and verify Phase 0.
2. Ship Phase 1 migration and server-side initiation changes together.
3. Deploy Phase 2 recovery APIs behind an internal flag.
4. Enable Phase 3 for the pilot cohort.
5. Add Phase 4 before expanding paid checkout beyond the pilot.
6. Complete Phase 5 before enabling production M-Pesa credentials.
