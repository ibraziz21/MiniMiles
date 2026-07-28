# Spec: Order Lifecycle Completion — Payment → Fulfilment → Terminal State

**Package:** `packages/hub-page` (+ merchant portal surface, + admin tooling)
**Companion:** `docs/paid-order-recovery-spec.md` (recovery is specced there;
this spec integrates it as one journey)
**Status:** Draft for review

---

## 0. The product truth this spec closes

Payment and order creation are nearly connected. **Order creation and actual
fulfilment are not connected at all.** Today an order can be born and nobody
— merchant, provider, or system — is obligated to move it, and money that
enters a failed journey has no tracked way back out.

The completion principle, stated once and enforced everywhere:

> **Every confirmed payment must end in exactly one of three places:
> a completed order, an active recovery, or a tracked refund.**
> No fourth bucket. No orphaned money, ever.

Everything below is machinery to make that invariant true and auditable.

---

## 1. Canonical state machine (single source of truth)

Two linked machines. Payment state never lives inside order state — their
separation is what makes recovery possible.

### Payment
```
initiated → pending → confirmed
                    → failed (terminal)
confirmed → consumed_by_order | in_recovery | refunded
```

### Order
```
placed → accepted → packed → out_for_delivery → delivered → received → completed
placed → provider_pending → delivered → completed                (digital)
placed|accepted → cancelled → (refund pipeline)                  (unhappy)
provider_pending → fulfil_failed → retrying → provider_pending
                                 → cancelled → (refund pipeline)
delivered → disputed → resolved(received | cancelled)
```

### Transition table (enforced, not documented-only)

All transitions go through **one server-side RPC**
(`advance_order_status(order_id, to_status, actor, meta)`) that:

1. Validates (from → to) against the table below — anything else is rejected.
2. Writes the matching `*_at` timestamp column (schema exists:
   `merchant_order_lifecycle.sql` — port to hub tables where missing).
3. Appends an `order_events` row (§5.1). No transition without an event.

| From → To | Allowed actor |
|---|---|
| placed → accepted / cancelled(reason) | merchant / customer-or-merchant |
| accepted → packed → out_for_delivery → delivered | merchant |
| placed → provider_pending | system (digital only) |
| provider_pending → delivered / fulfil_failed | system (adapter callback) |
| fulfil_failed → retrying / cancelled | system (≤3 attempts) / system-or-admin |
| delivered → received | customer (exists today) or system auto-complete (§4.4) |
| received → completed | system (reward release + settlement) |
| delivered → disputed | customer |
| disputed → received / cancelled | admin |
| any-pre-delivered → cancelled | admin (incident path) |

**Auto-complete rule:** `delivered` + 7 days without customer action →
system advances to `received`. Without this, physical orders hang forever
and rewards never release.

## 2. The six journeys on that machine

| Journey | Path | Unhappy branch |
|---|---|---|
| Physical delivery | placed → … → delivered → received → completed | merchant rejects at `placed` → cancelled → refund; delivery fails at `out_for_delivery` → merchant sets delivered:false note → admin cancel → refund |
| Digital item | placed → provider_pending → delivered → completed | adapter fails ×3 → cancelled → **auto-refund initiated without human action** |
| Paid-order recovery | payment confirmed, order creation failed → recovery record → user returns → order created **without new payment** | recovery unclaimed after 72h → admin queue → contact or refund |
| Failed fulfilment | any cancel after payment | must create a `refunds` row atomically with the cancel — cancel without refund row is impossible by constraint |
| Voucher purchase | voucher redeemed atomically at order creation (exists) | order cancelled → **compensating voucher reinstatement** (§4.3) in the same transaction as the cancel |
| Rewards | accrue pending at creation, release at completion (§6) | cancel/refund → pending reward voided, event logged; released rewards are never clawed back (impossible by timing) |

## 3. Merchant order inbox (the missing operational surface)

Without this, every status past `placed` is fiction. **Ships in
`Akiba-Platform/packages/dashboard-merchant`** (the merchant dashboard
Leshan uses), calling the hub's `advance_order_status` API keyed to the
merchant's own orders only (reuse the admin-protected status API pattern
from react-app for auth).

- **Inbox tabs:** New (`placed`) / In progress (`accepted|packed|out_for_delivery`)
  / Done / Cancelled. New shows recipient, items, basket value, voucher applied.
- **Actions:** Accept · Reject (reason required: out_of_stock | cannot_deliver
  | other+text) · Packed · Dispatched · Delivered. Buttons call
  `advance_order_status`; the UI can never invent a transition.
- **SLA surfacing:** `placed` > 24h unaccepted → flagged in portal AND admin
  queue (§7). Merchant reliability becomes measurable — this feeds merchant
  ROI reporting later.
- Reject → automatic cancel + refund initiation; the merchant never touches
  money flows.

## 4. Unhappy-path machinery

### 4.1 Refund pipeline (`refunds` table)
```
refunds: id, order_id, payment_ref, rail (mpesa|crypto|miles),
         amount, reason, status: initiated → processing → completed
                                          → failed → manual_review,
         external_ref (reversal code / tx hash), created_at, completed_at,
         UNIQUE(order_id)
```
- **Invariant (DB-enforced):** a `cancelled` order with a consumed payment
  MUST have a refunds row — created in the same transaction as the cancel.
- **Rails, pilot-honest:** M-Pesa reversal and crypto refunds start as
  `manual_review` items in an admin queue with the operator recording
  `external_ref` on completion. Automation is a later optimization; the
  *tracking* is the non-negotiable part. Miles-paid orders refund
  automatically via the mint queue (idempotency: `refund:{order_id}`).
- Customer sees refund status on the order detail ("Refund initiated →
  completed, ref XYZ") — silence is what creates disputes.

### 4.2 Digital fulfilment pipeline

**Catalog model (decided):** each digital item is a plain product SKU per
denomination — "Safaricom Airtime KES 100" and "Airtel Airtime KES 100" are
separate products with a `fulfillment_type: digital` flag and a
`fulfillment_meta` (network, denomination, or code pool). No provider
abstraction leaks into the catalog.

```
fulfillment_jobs: id, order_id, executor (manual|<provider-key>), payload,
                  attempts, status (pending|processing|delivered|failed),
                  provider_ref, last_error, next_retry_at
                  — pattern: minipoint_mint_jobs
```

- **Pilot executor = `manual`:** digital orders land in an ops fulfilment
  queue (same admin surface as refunds, §7). Operator sends the top-up /
  code, records the reference → job `delivered` → order advances. SLA:
  `provider_pending` > 30 min flags in the admin queue; the customer-facing
  order page shows "Being processed — usually within 30 minutes."
- Ops marks a job failed (wrong number, network issue) → `fulfil_failed` →
  auto-cancel → **refund row created automatically** — the human fulfils,
  the system owns the money consequence.
- **Later executor = provider adapter** per product (`fulfil(job) → {ok,
  providerRef} | {retryable} | {fatal}`, 3 retries, backoff 1m/10m/60m,
  exhausted → same auto-cancel/auto-refund path). Same jobs table, same
  states — automation swaps the executor, nothing else.
- Idempotency: jobs carry `order_id` as the external idempotency key
  (double-topup is as bad as no topup).
- Digital products go live **with the manual executor** — hidden only until
  the ops queue exists, not until an API integration does.

### 4.3 Voucher + settlement compensation
On cancel of an order that redeemed a voucher, same transaction:
- Voucher: `redeemed → issued` (reinstated); if expired meanwhile, extend
  +7 days. Event row records the round-trip.
- Settlement: append a negative adjustment row (never mutate the original
  settlement record) so merchant statements sum correctly.
- Purchase-event to rewards platform: emit a compensating `purchase_reversed`
  event (rewards §6 consumes it).

### 4.4 Disputes
`delivered → disputed` from the order page ("I didn't receive this"),
reason + optional text. Freezes auto-complete. Admin resolves → `received`
or `cancelled`+refund. Pilot volume will be tiny; the state existing is what
matters — without it disputes arrive as WhatsApp messages.

## 5. System backbone

### 5.1 `order_events` (append-only audit log)
```
order_events: id, order_id, actor (customer|merchant|system|admin),
              from_status, to_status, meta jsonb, created_at
```
Written by `advance_order_status` exclusively. This is the reconciliation
backbone, the debugging tool, and the merchant-dispute referee. Cheap to
build, impossible to retrofit.

### 5.2 Notifications (pilot: in-app only — decided)
```
notification_outbox: id, user_ref, order_id, template, channel, status, dedupe_key
```
| Event | Pilot channel |
|---|---|
| Payment confirmed / order placed | in-app |
| Accepted / dispatched | in-app |
| Delivered | in-app + prompt to confirm receipt |
| Digital delivered | in-app ("Your airtime is in — ref …") |
| Cancelled / refund initiated / refund completed | in-app |

Dedupe by `(order_id, template)`. The `channel` column stays so SMS/email
can be added per-template later without schema change. In-app = a
notifications feed + badge; the My Orders page remains the source of truth.

## 6. Reward timing — one policy, both apps

**Accrue-then-release** (single rule, ends the hub/react-app divergence):

1. **Accrue** at verified payment + order creation: reward computed, stored
   `pending`, shown to user as "≈ +40 Miles pending".
2. **Release** at terminal success (`completed`; digital `delivered` →
  completed is near-instant, so digital feels immediate).
3. **Void** on cancel/refund — pending is voided, nothing to claw back.
   Released rewards can never need reversal *by construction*, because
   release happens after the last cancellable moment.

Immediate feedback (users see the pending reward at purchase), zero clawback
machinery, and fulfilment-completion pressure lands on the merchant (their
customers' rewards release when they deliver). React-app's
"reward after receipt confirmation" flow migrates to this same rule
(its `miles_reward_status` column already fits: pending → queued → sent).

## 7. Admin reconciliation (queues, not dashboards)

One admin page, four queues, each a saved query over the tables above:

1. **Orphaned money:** payments `confirmed` > 1h with no order and no
   recovery claim → nudge or refund. (The §0 invariant, made visible.)
2. **Stuck orders:** any non-terminal state exceeding its SLA
   (placed 24h, accepted 48h, out_for_delivery 72h, provider_pending 15m).
3. **Refunds in manual_review** > 48h.
4. **Disputes** open > 72h.

A daily cron posts queue counts (Slack/email). Empty queues = the lifecycle
is complete; the queues *are* the definition of done.

## 8. Build order

1. `order_events` + `advance_order_status` RPC + transition table (backbone — everything else depends on it)
2. Merchant order inbox (physical journey becomes real)
3. Refund pipeline + voucher/settlement compensation + cancel flows
4. Reward accrue/release policy (both apps)
5. Auto-complete + disputes + notifications outbox
6. fulfillment_jobs + manual ops executor → unhide digital products
   (provider adapters later, executor-swap only)
7. Admin reconciliation queues + daily digest

## 9. Acceptance criteria

- Every status change writes an order_event; direct status UPDATEs outside
  the RPC are revoked at the DB level.
- Cancel of a paid order without a refunds row is impossible (constraint).
- Merchant can move a real order placed → delivered from the portal;
  customer sees each step on My Orders.
- Digital purchase with adapter down: 3 retries → cancelled → refund row →
  customer notified. No order stuck in provider_pending > 1h.
- Cancelled voucher order: voucher usable again, settlement adjustment row
  present, reward voided.
- Recovery journey: pay → kill page → return → "Payment confirmed — finish
  your order" → order created, no second payment (per recovery spec).
- All four admin queues return zero rows after a clean test cycle.

## 10. Decisions (resolved)

1. **Notifications:** in-app only for the pilot; outbox keeps the channel
   column for later SMS/email.
2. **Merchant inbox:** lives in `Akiba-Platform/packages/dashboard-merchant`,
   operating the hub's `advance_order_status` API.
3. **Digital items:** modeled as per-denomination product SKUs
   ("Safaricom Airtime KES 100" etc.); pilot fulfilment via the manual ops
   executor — no provider API required to launch. Adapter automation later
   swaps the executor only.
4. **Crypto refunds:** manual treasury send for pilot, surfaced to the
   customer with an explicit expectation — refund status shows
   "Refunds are processed within 48 hours" until `completed` with the tx
   reference. Never silent.
