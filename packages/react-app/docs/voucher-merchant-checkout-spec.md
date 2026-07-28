# Spec: Voucher Merchant Context + Stablecoin Checkout Upgrade

**Package:** `packages/react-app`
**Depends on:** `docs/spend-earn-redesign-spec.md` (shipped — establishes `/vouchers`
and `GET /api/Spend/vouchers/user/[address]`), `docs/skill-games-voucher-prizes-spec.md`
(shipped on this branch — the weekly-challenge win path now feeds the same
voucher redemption flow this spec upgrades)
**Status:** Draft for review

---

## Context

A voucher — whether bought with Miles or won (claw, raffle, weekly
leaderboard, grants) — currently redeems through `VoucherOrderSheet`
(`components/voucher-order-sheet.tsx`), a 5-step sheet (Product → Voucher →
Delivery → Payment → Done) reachable from `/vouchers`. It already does more
than it looks like it does: `POST /api/Spend/orders` genuinely verifies a
stablecoin (cUSD/USDT/USDC) transfer on-chain before completing the order —
this is not a stub. But it has three real gaps:

1. **No merchant identity/context.** The sheet opens straight into a product
   picker; a voucher winner never sees *who* they're redeeming with (name,
   logo, location) the way `hub-page`'s `/shop/[slug]` page shows before
   checkout. `/spend`'s `MerchantVoucherSheet` shows voucher templates only,
   never a product catalog or merchant profile.
2. **No physical/digital distinction.** Every order assumes physical
   shipment — a mandatory recipient name/phone/city form and a delivery fee
   — even for products that need no shipping at all (airtime top-up, a
   gift-card code). `merchant_products` has no column for this today.
3. **Payment goes to a flat, merchant-agnostic address** (`DELIVERY_FEE_ADDRESS`
   env var), not the specific merchant's own wallet — `hub-page` already pays
   `partner_settings.wallet_address` directly and verifies the transfer
   landed there.

This is **not** a request to build a marketplace in this app — 
`spend-earn-redesign-spec.md` already decided full storefront depth belongs
elsewhere. This spec only deepens the existing, already-scoped
one-voucher-to-one-merchant redemption path: show the merchant, split
physical vs. digital fulfillment, pay the right wallet.

## Goals / non-goals

**Goals**

1. Before/during redemption, show the voucher's specific merchant (name,
   logo, location, support contact) — reusing `hub-page`'s existing
   `partners`/`partner_settings` data, not a new table.
2. Split checkout into physical (ship it, current flow) vs. digital (no
   shipping — collect the right delivery target instead) based on a real
   `merchant_products` column, reusing `hub-page`'s naming.
3. Pay the merchant's actual wallet, verified the same way `hub-page`
   already verifies `hub-page`'s on-chain payments.
4. Keep it lightweight: no new ops surface, no marketplace browsing depth.

**Non-goals**

- No product catalog browsing beyond the one voucher's linked
  product/category (matches the existing scope of `VoucherOrderSheet`).
- No replicating `hub-page`'s full order-lifecycle state machine
  (`accepted → packed → out_for_delivery → delivered → received → completed`)
  — a voucher redemption is a single-item, low-friction event, not a
  tracked multi-item shipment.
- No rebuilding `merchant_transactions`/`order_events` — react-app keeps
  writing its own lighter order row (see §4).

---

## 1. Verify before building: is `merchant_products` actually shared?

`hub-page` and `react-app` connect to the same Supabase project. Before
writing any migration, confirm whether `merchant_products` is the **same
physical table** both apps already query (which would mean `product_type`
may already exist on live data, just unused by react-app's queries) or
whether react-app has its own copy. Run:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'merchant_products'
order by ordinal_position;
```

If `product_type` (or similarly-named) already exists, §3 below is a
read-and-branch change only — no migration needed, just widen react-app's
`SELECT` in `app/api/Spend/orders/products/route.ts` and branch the UI on
it. If it doesn't exist, add it exactly as hub-page defined it (see below).

## 2. Merchant context surface

Currently `/spend`'s `MerchantVoucherSheet` shows voucher templates only —
no product catalog, no merchant profile fields. `/vouchers` → "Use voucher"
opens `VoucherOrderSheet` directly into product-picking, with no merchant
identity shown at all.

**Change:** `VoucherOrderSheet`'s Step 0 (Product) gets a merchant header
above the product list — logo (`partners.image_url` or
`partner_settings.logo_url`), name, country, support email — sourced from
the already-existing `GET /api/Spend/merchants/[slug]/route.ts` (extend its
response with `partner_settings` fields if not already included; it
currently returns `partners` + voucher templates only per the earlier
investigation — confirm and extend). No new route needed if that one is
widened; no new page needed since this is a step inside the existing sheet,
consistent with "lightweight."

## 3. Physical vs. digital fulfillment

Reuse `hub-page`'s exact column name and values if §1 confirms the column
already exists: `merchant_products.product_type: 'physical' | 'digital'`.
If it needs to be added fresh, add it with those same values for
cross-app consistency (a product created in `dashboard-merchant` or
`hub-page`'s admin tooling should mean the same thing here).

**Physical** — unchanged: Step 2 (Delivery) collects recipient
name/phone/city, `lib/spendOrderPricing.ts`'s city-tier delivery fee
applies, `POST /api/Spend/orders` requires `city`.

**Digital** — new branch, decided by product sub-kind (clarified in
conversation: airtime tops up a phone number the user already has;
gift-card-style items send a code to an email — these need different
destination fields, which `product_type` alone can't distinguish). Add
`merchant_products.digital_delivery_kind: 'airtime_topup' | 'code_delivery'`
(nullable, only meaningful when `product_type = 'digital'`):

- `airtime_topup` → Step 2 collects a phone number only (no city, no
  delivery fee — `spendOrderPricing.ts` returns `{ fee: 0, eta: "Instant" }`
  for digital, matching `hub-page`'s `getDeliveryInfo` digital branch).
- `code_delivery` → Step 2 collects an email address only.

**Fulfillment execution — reuse `hub-page`'s `fulfillment_jobs` queue,
don't rebuild an ops surface.** `POST /api/Spend/orders` already atomically
claims the voucher, verifies payment, and inserts the order row; for a
digital product it additionally calls the same `enqueue_digital_fulfillment`
path `hub-page`'s order route uses (or an equivalent RPC call against the
same `fulfillment_jobs` table), with a payload carrying whichever
destination field applies (`{ phone }` or `{ email }`). The existing manual
executor/ops process on the `hub-page` side handles delivery — react-app
doesn't need its own ops tooling; it just needs to enqueue into the queue
that already exists and already has people watching it. This is the
concrete reason to prefer reuse over "mark delivered instantly": there is
real fulfillment work (an actual airtime top-up, an actual emailed code),
not nothing, and `hub-page` already solved where that work goes.

**The ops UI does not support `email` yet — confirmed, needs a small
update.** `packages/admin-dashboard/src/app/(dashboard)/fulfillment/page.tsx`
hardcodes `Job["payload"]` as `{ product_id?, item_name?, recipient_name?,
phone? }` and the Recipient column only ever renders `recipient_name`/`phone`
— a `code_delivery` job's `email` would render as a blank recipient today.
Fix is small and contained to that one file: widen the `Job["payload"]`
type to add `email?: string`, and render it in the Recipient column
alongside/instead of `phone`. `components/fulfillment/FulfillmentJobActions.tsx`
needs **no change** — it's already payload-agnostic (generic "Top-up / code
reference" input, just records whatever string into `provider_ref`
regardless of delivery kind).

## 4. Payment destination + verification

`VoucherOrderSheet`'s `handlePay()` and `app/api/Spend/orders/route.ts`'s
`verifyPayment()` currently target `DELIVERY_FEE_ADDRESS` (a single env-var
address) — every merchant's stablecoin payment lands in the same place.
Change both sides to target `partner_settings.wallet_address` for the
specific merchant being ordered from, mirroring `hub-page`'s
`verifyOnChain(txHash, expectedTo, ...)` pattern exactly (`expectedTo` =
that merchant's wallet, not a shared constant). `app/api/Spend/orders/route.ts`
already reads `partner_settings.store_active`/`delivery_cities` for this
merchant — add `wallet_address` to that same lookup.

**Null wallet_address — fall back to the shared address, don't block
checkout.** Confirmed the fallback is safe: `merchant_transactions` already
inserts `partner_id: product.merchant_id` on every order row (`app/api/Spend/orders/route.ts`,
main), so a payment that lands in the shared `DELIVERY_FEE_ADDRESS` because
a merchant hasn't set a wallet yet is still unambiguously traceable back to
that merchant for later settlement/reconciliation — the traceability
condition is already satisfied by existing data, no new column needed.
Verification logic: `expectedTo = partner_settings.wallet_address ??
DELIVERY_FEE_ADDRESS`.

No change to the underlying transfer mechanism (direct ERC-20 `transfer`,
cUSD/USDT/USDC, Celo) — react-app's existing ad hoc `viem`
`walletClient`/`publicClient` calls in `VoucherOrderSheet` are functionally
equivalent to `hub-page`'s `CartDrawer.payCrypto()`; consolidating them into
a shared `payStablecoin({ token, to, amountUsd })` helper (e.g. on
`useWeb3`) is a worthwhile cleanup but not required for this spec's goals —
flagged as a nice-to-have, not blocking.

## 5. Data model summary

- `merchant_products.product_type` — add only if §1 confirms it's missing;
  otherwise already there.
- `merchant_products.digital_delivery_kind` — new, nullable, react-app/
  hub-page-shared table (this granularity doesn't exist in hub-page today;
  confirm with whoever owns hub-page's product catalog before adding, since
  it's a shared table other apps read too).
- No changes to `issued_vouchers`, `spend_voucher_templates`, or
  `merchant_transactions` beyond what already exists.

## 6. Rollout order

1. Run the §1 check; confirm shared-table assumption before writing any migration.
2. Add `digital_delivery_kind` (and `product_type` if missing) to `merchant_products`.
3. Extend `GET /api/Spend/merchants/[slug]` (or whatever route backs
   `VoucherOrderSheet`'s product step) to return `partner_settings` fields +
   `product_type`/`digital_delivery_kind` per product.
4. `VoucherOrderSheet`: merchant header on Step 0; branch Step 2 on
   `product_type` (physical form / phone field / email field); update
   `spendOrderPricing.ts` for the digital `{fee: 0, eta: "Instant"}` case.
5. `POST /api/Spend/orders`: read `partner_settings.wallet_address` for
   payment verification instead of `DELIVERY_FEE_ADDRESS` (falling back to
   it when null, per §4); enqueue a `fulfillment_jobs` row for digital
   orders instead of the physical delivery-tracking assumption.
6. `packages/admin-dashboard`: widen `fulfillment/page.tsx`'s `Job["payload"]`
   type to include `email?: string` and render it in the Recipient column —
   the one concrete cross-app change this spec requires outside react-app.
7. End-to-end test one physical redemption and one of each digital kind
   against a real testnet/staging merchant wallet, including a
   `code_delivery` job showing up correctly in the admin fulfillment queue.

## 7. Decisions from review

1. **Admin ops UI needs updating — confirmed, not assumed.** See §3; scoped
   to `fulfillment/page.tsx`'s payload type + Recipient column, one file.
2. **Sticking with exactly two `digital_delivery_kind` values
   (`airtime_topup`, `code_delivery`) for now.** A third "no delivery detail
   needed" case is deferred until a real product needs it — not designing
   for it speculatively.
3. **`partner_settings.wallet_address` null → fall back to the shared
   `DELIVERY_FEE_ADDRESS`, don't block checkout.** Safe because
   `merchant_transactions.partner_id` already makes every order traceable
   to its merchant regardless of which wallet the funds landed in — see §4.

## 8. Acceptance criteria

- Opening a voucher's redemption flow shows that voucher's specific
  merchant (name, logo, location) before any product/payment step.
- A physical-product voucher redemption is unchanged from today's flow.
- A digital-product voucher redemption collects only the relevant
  destination field (phone or email, per `digital_delivery_kind`), shows
  $0 fee / "Instant" ETA, and enqueues a real fulfillment job rather than
  silently completing with nothing to deliver.
- Stablecoin payment for any merchant verifiably lands in that merchant's
  own `partner_settings.wallet_address`, not a shared address.
