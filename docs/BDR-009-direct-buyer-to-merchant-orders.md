# BDR-009 — Direct buyer-to-merchant orders

**Status:** Proposed

**Relates to:** [Online merchant orders specification](online-merchant-orders-spec.md), [Welcome offer](BDR-008-new-user-welcome-offer.md)

## Scope and payment boundary

Start with order requests on existing business pages. Buyers and merchants agree on stock, price, and delivery in Akiba. The merchant accepts the order before payment instructions appear. Buyers pay the merchant directly, either before dispatch or at handover. Merchants handle fulfilment, returns, and refunds. Akiba records order status, merchant payment acknowledgements, and issue reports. The pilot has no payment initiation, Daraja, checkout, escrow, or refund execution. Phase 1 includes a small product catalogue on merchant pages and the complete order flow within existing navigation. Phase 2 adds product discovery and completed-order reviews.

## Payment and fulfilment evidence

For M-Pesa, the buyer submits a transaction reference and the merchant checks it against their payment records. The same reference can attach to only one order across Akiba. Cash collection is acknowledged by the merchant and has a lower evidence tier.

The merchant marks the order dispatched. Buyer **Received** or a valid delivery PIN records handover. A dispatched order can auto-complete after 72 hours if payment is acknowledged and there is no open issue. The order retains its completion method. Merchant acknowledgement, PIN entry and auto-completion do not create independently verified payment or verified visit evidence.

## Rewards and disputes

Reserve an eligible merchant-funded voucher at order creation. Redeem it at payment acknowledgement and release it on order rejection or unpaid expiry. The spec defines cancellation, disputed payments, and voucher reinstatement.

Credit capped, merchant-funded Miles when the order completes, with open disputes holding the award. Both M-Pesa and cash are eligible under their respective evidence rules. Keep Akiba-funded welcome vouchers, referral payouts, and verified-visit benefits out of the pilot. A future proposal could consider independent payment evidence and stronger abuse controls before enabling Akiba-funded value. A C2B integration would require a separate decision.
