# BDR-001 — Value Gifting: funding model

**Status:** Accepted
**Date:** 2026-10-09
**Decision owner:** Ibrahim
**Supersedes:** the "Network Gift Pass" concept (pooled Akiba-held balance)

---

## 1. Why this record exists

Akiba wants a gifting product: a member sees that a friend has a birthday,
graduation or new baby, and buys them value redeemable at Akiba merchants.

The first design put Akiba in the middle of the money: the buyer paid Akiba, Akiba
held a liability, the recipient spent against it anywhere on the network, and Akiba
settled merchants afterwards. That design was rejected before implementation.

This record exists so that when someone asks in six months "why didn't we build
network-wide gift cards?", the answer is here rather than being re-derived.

## 2. Context at the time of the decision

Three things in the existing system decided this, all of them discoverable in the
repository.

### 2.1 Akiba deliberately exited taking shopper payments

`packages/hub-page/src/lib/directCommerceRetired.ts` returns HTTP 410 on every
cart, checkout, payment-initiation and order endpoint. The spec behind it,
`packages/hub-page/docs/skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md`,
states that Akiba "does not sell merchant products, take product payments, create
orders, arrange delivery, or provide order tracking."

`akiba-platform-billing-policy-handoff.md` records it as a locked business rule:

> Shopper payments never pass through Akiba.
> M-Pesa and bank transfer are used only to pay Akiba merchant subscription invoices.

That retirement was not a cleanup of dead code. It ran in gates: Gate 0 inventoried
pending M-Pesa requests, non-terminal orders, open disputes, refund jobs and
unresolved voucher reservations; removal was complete only when Gate 2 reported
**zero unresolved liabilities**.

The pooled-balance gift design reintroduces every one of those concerns, plus a
five-year tail that cannot be retired the same way. When an architecture has already
been deliberately simplified, the burden of proof is on the party reintroducing the
complexity. We could not meet it.

### 2.2 There is no inbound consumer payment rail

`packages/hub-page/src/lib/mpesa.ts` is now explicitly read-only — "retained solely
to reconcile STK pushes that were already pending when direct commerce was retired.
This module cannot initiate a new consumer payment."

Outbound is also not live. `supabase/migrations/006_voucher_payout_execution_phase5.sql`
opens with: live payout execution is blocked, no M-Pesa B2C credentials, no Celo
signing key, only the `test` and `manual` providers are enabled.

So the pooled design required building both a collection rail and a payout rail from
nothing, and operating a float between them.

### 2.3 The regulatory exposure is custody, not classification

The original design argued against classification as an Electronic Money Issuer. That
framed the wrong risk. The exposure is holding customer funds, and the standard
closed-loop defence is weakest in exactly our shape: it is strong when the issuer is
the merchant (a coffee chain selling its own card) and weak when a third party sells an
instrument redeemable across many unaffiliated merchants. Pooled network-wide value is
the second case. A single-merchant gift is the first.

Related unaddressed obligations under the pooled design: a segregated trust account for
outstanding liability, KYC on senders, AML monitoring, and dormancy reporting under the
Unclaimed Financial Assets Act. None are blockers in principle; all are a different
company.

## 3. Options considered

### Option A — Network Gift Pass (pooled Akiba-held balance)

Buyer pays Akiba, Akiba holds the liability, recipient spends anywhere on the network,
Akiba settles merchants.

Rejected for MVP. Best possible UX and the strongest network effects, but it makes Akiba
the custodian of customer funds, requires a trust account and treasury function, and
reopens the liability, refund and dispute domain that was deliberately removed. It also
requires two payment rails that do not currently exist.

### Option B — Merchant-funded gift voucher

Buyer pays the merchant, the merchant funds the voucher, Akiba issues and tracks it.
Akiba never owns the money.

**Chosen.** Maps onto the existing voucher platform almost unchanged: issuance,
presentation tokens, redemption, settlement terms, reporting and merchant programmes
all already exist and are hardened across migrations 001–007.

### Option C — Collection gifts ("gift coffee, not cash")

The sender gifts a category rather than a merchant: a Coffee gift, a Restaurant gift.
Preserves merchant discovery, which single-merchant gifting otherwise loses, and matches
a real intent — someone who wants to buy you coffee wants to buy you *coffee*, not
spending power.

**Adopted as a merchandising layer over Option B, not as a separate funding model.**
See §4.2: the reason is that pooled allocation across a collection is Option A wearing
a different hat.

## 4. Decision

**Akiba Gifts are merchant-funded vouchers issued through the existing voucher platform.
Akiba holds no shopper funds at any point.**

### 4.1 What Akiba is in this model

Akiba is the issuance, delivery, presentation and reporting layer. The merchant is the
issuer of the stored value and holds the prepaid liability — legally and operationally
the same position as a restaurant selling its own gift card. Akiba's revenue is a fee
charged to the merchant for customer acquisition, not a fee charged to the shopper for
a payment service.

### 4.2 Why collections do not get their own funding model

A gift redeemable at any of four coffee merchants has no payable merchant at the moment
of purchase. The three ways to resolve that:

| Resolution | Consequence |
|---|---|
| Pay one merchant, reallocate on redemption | Inter-merchant clearing; whoever nets it holds the float. This is Option A. |
| Split across all participating merchants at purchase | Merchants hold funds against gifts that will never be redeemed with them. |
| **Resolve the merchant before money moves** | **Chosen.** Collections are discovery and merchandising; funding stays merchant-specific. |

So "across the Akiba merchant network" means the *choice* spans the network, not the
*balance*. The sender picks a category, Akiba recommends merchants from across the
network using the recipient's signals, the sender confirms one, and that merchant is
funded. Discovery is preserved on both sides: the sender browses merchants they did not
know, and the recipient visits one.

### 4.3 The service fee is charged to the merchant, not the sender

A KES 50 sender surcharge would be shopper money passing through Akiba — the rule this
whole decision rests on. The fee is therefore merchant-side.

This is also the better product. The sender sees "KES 2,000, no fees", which converts
better than KES 2,050. And it prices the thing honestly: the merchant is buying a
prepaid customer with a reason to walk in, at a rate far below what they pay for
customer acquisition elsewhere.

Two mechanics, decision deferred to the payment-rail choice in §7.1:

- **Split at source** — a PSP with sub-merchant settlement routes the merchant's share
  and Akiba's fee separately. No collection risk. Preferred.
- **Invoiced** — the merchant receives the full face value and the fee appears as a line
  on their next subscription invoice, using the arrears mechanism already specified in
  `akiba-platform-billing-policy-handoff.md`.

## 5. Akiba Gifts v1 — feature definition

Product level, not an engineering spec. The engineering spec follows this record.

### 5.1 Naming

The feature is **Akiba Gifts**. The object is a **Gift**.

`pass` is reserved and must not be used. `hub_user_passes` is the member account object
— `supabase/migrations/072_admin_pass_analytics.sql` calls it "the canonical signup
timestamp for Pass reporting" — and "Akiba Pass" is already a shipped, marketed concept
meaning the member's personal loyalty QR at pass.akibamiles.com, with `/akiba-pass`
onboarding and `AkibaPassCampaignBanner.tsx` in the React app. A `passes` table or a
"Pass Wallet" would collide in schema, support and marketing simultaneously.

### 5.2 Lifecycle

```
[Sender picks merchant or collection]
          ↓
[Sender pays the merchant — never Akiba]
          ↓
[Payment confirmation webhook]
          ↓
[Akiba issues N gift vouchers against that merchant]
          ↓
[Delivery: in-app to @username, or SMS link to phone]
          ↓
[Recipient claims → vouchers land in their voucher list]
          ↓
[Redemption at merchant via existing presentation-token QR]
          ↓
[No settlement payment — merchant already holds the funds]
          ↓
[Akiba's acquisition fee: split at source, or invoiced in arrears]
```

### 5.3 Denomination splitting replaces partial redemption

The voucher engine is discount-based and single-redemption. `issued_vouchers` carries
`discount_percent`, `discount_cusd`, `max_discount`, `discount_applied` and `redeemed_at`,
and the status machine runs `issued → redeemed`. There is **no `remaining_value`
anywhere**, and adding it would mean modifying the one subsystem hardened across seven
migrations.

**A gift therefore issues multiple fixed-value vouchers rather than one balance.**
A KES 2,000 gift issues 4 × KES 500. `issue_voucher_from_program` is called four times
and is otherwise untouched.

This is better for the stated goal, not merely cheaper. One balance produces one visit.
Four vouchers produce up to four visits, which is four chances for the merchant to
convert a gift recipient into a regular. It is the single biggest lever on "merchant
earns a new customer through a gift redemption."

Accepted costs: granularity is the denomination (a KES 500 voucher on a KES 300 bill
loses KES 200 of value), and the recipient must make several visits to use the full
gift. Mitigations: offer denominations per merchant category so coffee gifts split
smaller than salon gifts, and state the no-change rule plainly at purchase and on the
gift itself.

### 5.4 Recipient addressing

**On-network: `@username`.** `resolve_voucher_recipient_username` already exists in
`supabase/migrations/095_voucher_username_identity_foundation.sql` and resolves a public
username to the immutable `hub_user_id` that owns vouchers. It fails closed on
not-found and on ambiguous links, and never falls back to email, phone or wallet. This
is the primary path.

**Off-network: phone, as a delivery address only.** An SMS link to a claim page. The
phone number must never become a standing credential: Safaricom reassigns dormant
numbers, so a long-lived instrument keyed to a phone number means the number's next
owner can claim the gift. The number is used once, for delivery and claim; ownership
binds to `hub_user_id` at claim and the phone has no authority afterwards.

Rate-limit the claim step with the primitive in
`supabase/migrations/050_shared_rate_limit_primitive.sql`.

### 5.5 Redemption reuses the hardened path

No new redemption engine. `supabase/migrations/004_voucher_asset_qr_redemption.sql`
already provides presentation tokens stored as SHA-256 only — "raw tokens never touch
the database" — with a unique partial index on the hash, a trigger that clears the token
on any status change so an old screenshot cannot be resurrected, a 120-second maximum
token lifetime, and a uniform failure shape in `inspect_voucher_presentation` that blocks
enumeration.

The original design's 60-second rotating QR with the merchant typing the amount after
the scan is both weaker and unnecessary: weaker because it stored the nonce in plaintext,
unnecessary because a fixed-value voucher needs no amount entry at all. Dropping
merchant-entered amounts also removes the merchant-billing-abuse vector the dynamic QR
was invented to close.

### 5.6 Settlement

`funding_party_type = 'merchant'` with `reimbursement_rate = 0` in
`voucher_program_settlement_terms`. The merchant already holds the buyer's money, so
redemption creates **no payable from Akiba**. This is why the model works with outbound
payouts still blocked: Akiba owes nothing on a gift redemption.

### 5.7 Merchant exposure cap — new control required

The liability moves to the merchant, which is correct, but it creates an exposure Akiba
has not carried before: a merchant that closes or defaults with outstanding gift
vouchers leaves recipients holding worthless gifts with Akiba's brand on them.

Required before launch:

1. A cap on outstanding gift face value per merchant, tied to plan tier.
2. A clause in `AkibaMiles_Merchant_Agreement_Template.docx` covering honour obligation,
   the cap, and what happens to outstanding gifts on termination.
3. Admin visibility into outstanding gift liability per merchant.
4. A stated policy for recipients when a merchant does fail. Deciding this after the
   first failure is worse than deciding it now.

## 6. Explicitly not in Phase 1

- Pooled, network-wide spendable balance.
- Partial redemption and running balances.
- Any flow where Akiba receives shopper funds, for any duration.
- Cash-out, refund-to-cash, or gift-to-Miles conversion.
- Gift resale or forwarding between recipients.
- Sender-paid fees.

## 7. Open decisions, in priority order

### 7.1 Payment rail — blocking, decide first

No inbound rail exists (§2.2), and the choice determines the fee mechanism, the
onboarding burden per merchant, and how long a gift purchase takes to confirm.

| Option | Custody | Fee collection | Cost |
|---|---|---|---|
| PSP with sub-merchant settlement | Licensed PSP holds funds in transit | Split at source | Per-transaction fee; a PSP integration to build |
| Merchant's own till/paybill, Akiba registered as C2B confirmation URL | None — funds land with the merchant directly | Invoiced in arrears | Safaricom URL registration per merchant shortcode; heavy per-merchant ops |
| Akiba paybill, Akiba settles merchants | **Akiba** | Any | Rejected — this is Option A |

Recommendation: PSP with sub-merchant settlement for launch, direct till as a fallback
for large merchants who insist on settling to their own account.

### 7.2 Currency

The settlement layer is cUSD-denominated: `voucher_program_settlement_terms.settlement_currency`
defaults to `cUSD`, and `voucher_settlement_entries` has columns literally named
`gross_amount_cusd` and `discount_amount_cusd`. Gifts are KES. Templates carry
`discount_cusd`, with no KES fixed-value field.

Needs resolution: a KES-native fixed-value voucher type, or a documented FX snapshot
convention at issuance. With `reimbursement_rate = 0` no money actually moves, so this
is a reporting-accuracy problem rather than a payment one — but the face value shown to
a recipient must be exactly the KES the sender paid.

### 7.3 Expiry and dormancy

Confirm with counsel what the Unclaimed Financial Assets Act requires for
merchant-issued gift certificates: the dormancy period, who reports, and whether a
merchant-issued instrument makes the merchant rather than Akiba the holder of record.
The earlier design assumed five years; that figure was not verified and may be wrong in
the direction that matters.

### 7.4 Schema deltas

Both enums need a consumer-funded value, and neither has one today:

- `voucher_programs.funding_type` is `('miles','akiba','sponsor','free')`.
- `voucher_program_settlement_terms.funding_party_type` is `('akiba','merchant','sponsor','none')`.

Plus a gift object linking purchase, sender, recipient and the issued voucher set, and a
KES fixed-value voucher type per §7.2. This is the whole data-layer cost of the feature.

## 8. Roadmap

### 8.0 Two partner classes, not one

A recurring confusion worth heading off: "getting a PSP partner" does not unlock
network-wide gifting. Two distinct counterparties are involved, and only the second one
does.

| | Phase 1 needs | Phase 3 needs |
|---|---|---|
| Role | Payment **router** | Licensed **float holder** |
| What it does | Splits the sender's payment between merchant and Akiba fee | Holds a stored-value balance over time and administers it |
| Custody duration | Seconds, in transit | Potentially years |
| Licensing bar | Ordinary PSP; several Kenyan providers offer sub-merchant settlement off the shelf | CBK-licensed e-money issuance, a bank, or a trust arrangement |
| Alternative | Merchant's own till with C2B confirmation (no PSP, heavy per-merchant ops) | None |

Signing a sub-merchant-settlement PSP for Phase 1 therefore does **not** put Akiba one
step from Phase 3. A router is generally not licensed to hold balances, and Phase 3
remains a separate conversation with a different class of counterparty.

### 8.1 Phases

**Phase 1 — Akiba Gifts.** Merchant-specific, merchant-funded, on the existing voucher
platform. Denomination-split. `@username` and SMS delivery. No Akiba-held funds.
Requires the payment-router decision in §7.1.

**Phase 2 — Collections.** Coffee, Restaurants, Beauty, Date Night. A merchandising and
recommendation layer over Phase 1 funding, using `hub_user_saved_merchants` and the
`category_slug` taxonomy in `081_verified_discovery_core.sql` to recommend merchants the
recipient will actually like. Gifts become a discovery surface: swipe signals feed gift
recommendations, and gift redemption feeds merchant acquisition.

Phase 2 **requires no new partner and no new payment rail** — it runs entirely on Phase 1
infrastructure. This is where the sender experiences the network: they choose a category,
Akiba recommends merchants from across the whole network, and the sender confirms one.
Network-wide *choice* lands here. Network-wide *balance* is Phase 3 and may never be
needed.

Optional Phase 2 experiment — **pick-then-pay**: the sender sends a Collection
invitation, the recipient chooses the merchant, and only then does the sender's payment
fire to that merchant. True network-wide choice with zero float. Costs a second sender
action and will lose conversion; worth testing, not worth launching on.

**Phase 3 — Universal Akiba Gift.** Pooled, spend-anywhere value. Requires either that
Akiba deliberately enters the payments and e-money space, or a partnership with a
licensed float holder per §8.0 — not merely the Phase 1 router. That is a company-level
decision, not a product one, and this record does not make it.

Phase 3 is not abandoned, but it is **optional rather than the destination**. Phases 1
and 2 build the demand evidence that would justify the licensing conversation, and if
Collections prove to satisfy the actual gifting intent — people want to buy a friend
coffee, not spending power — Phase 3 may never be worth its regulatory cost. Revisit it
only on evidence from Phase 2, not on the availability of a payment partner.
