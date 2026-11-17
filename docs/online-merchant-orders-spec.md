# Online merchant orders pilot

**Status:** Proposed

**Decision:** [BDR-009](BDR-009-direct-buyer-to-merchant-orders.md)

## Order and payment states

Start an account-bound request from an existing business page or a merchant invitation. Record the items or note, price, selected voucher, and proposed fulfilment terms. The merchant accepts only after confirming availability, delivery fee, and allowed payment methods. If the final terms differ from the request, require the buyer to accept the updated quote before showing payment instructions. Recheck voucher eligibility against the final terms.

- **Prepaid M-Pesa:** Requested → Accepted → Payment submitted → Payment confirmed → Dispatched → Completed.
- **Pay on delivery or pickup:** Requested → Accepted → Dispatched or Ready for pickup → Payment acknowledged and handover recorded → Completed. For M-Pesa, the buyer submits the reference and the merchant confirms it. For cash, the merchant acknowledges collection without a reference. Handover can be recorded while electronic payment review is pending.
- Track payment, fulfilment and disputes separately. Rejected, Expired and Cancelled close unpaid orders as appropriate. A dispute opens an issue and freezes automatic completion and pending rewards. For an order with submitted or acknowledged payment, use the issue and refund process before closing it as cancelled.

## Payment references and timeouts

- For this pilot, validate a trimmed M-Pesa reference as exactly 10 ASCII uppercase letters or digits. Confirm this input assumption with representative receipts before launch. Format validation is a typo check.
- Restrict references to authorized order participants and support. Bind each normalized reference to at most one order across Akiba with a database uniqueness constraint on reference ownership. Allow retries on the same order. Retain submitted references for the audit trail, including superseded ones. If a typo blocks a legitimate buyer on another order, route the conflict to support for audited resolution without exposing the other order.
- The merchant compares reference and amount to their own records. A rejection requires a reason such as **Code not found** or **Amount doesn’t match**. The buyer can resubmit once. A second rejection opens a dispute.
- Proposed defaults are four hours for merchant acceptance and a reminder after 24 hours of unreviewed payment submission, followed by a dispute at 48 hours. For accepted prepaid orders, display the payment deadline. A payment submission or buyer report that payment was sent prevents ordinary unpaid expiry and routes the order for review. Provide a support route for payment sent before expiry when the reference arrives late.

## Handover

Show a random, single-use four-digit PIN only to the signed-in buyer after dispatch or pickup readiness. Tell the buyer to share it only after inspecting and receiving the goods. Merchant or authorized delivery staff submit it through an order-scoped action. Limit guesses, record successful use once, and keep the PIN out of merchant views and notifications. **Received** is an alternate buyer action. PIN or Received records handover and completes the order once payment is acknowledged and there is no open issue.

After 72 hours from dispatch, auto-complete an undisputed delivery with acknowledged payment if neither handover action was used. Notify the buyer before the deadline and offer **Report a problem**. For pickup, start the timer from a separately recorded handover attempt or merchant-reported collection, never from **Ready for pickup** alone. Record whether completion came from Received, PIN, or timeout. A timeout records workflow closure only.

## Rewards and refunds

| Payment option | Voucher | Miles |
|---|---|---|
| Prepaid M-Pesa | Redeem reserved merchant voucher when the merchant confirms receipt of payment | Capped merchant-funded Miles at undisputed completion |
| M-Pesa on delivery or pickup | Same rule after reference review | Same rule at completion |
| Cash on delivery or pickup | Redeem reserved merchant voucher when merchant acknowledges cash collection | Capped merchant-funded Miles at completion, under lower-trust cash limits |

Reserve an eligible merchant-funded voucher when the request is created. Release it on rejection, cancellation, or expiry if it is still unspent and the order has no unresolved payment issue. For a redeemed voucher, resolve reinstatement through the cancellation or refund outcome under the voucher terms. The merchant refunds the buyer directly. Akiba tracks the reported outcome and can hold or reverse the reward and reconcile the voucher. Publish no Akiba-funded discounts or referral rewards for these orders and create no verified purchase or visit evidence.

Reserve Miles budget against the merchant before promising an award. Finalize voucher and Miles changes idempotently. Hold awards while a dispute is open, release any unused budget on closure without an award, and reconcile Miles if an order is refunded after completion. Monitor repeat buyer–merchant pairs and linked accounts, and cap cash awards separately. Before considering Akiba-funded value, assess account age, pair limits and independent payment evidence under a separate decision.

## Notifications

| Event | Buyer | Merchant |
|---|---|---|
| Request created | Request sent | New order request |
| Accepted or revised | Accepted terms or quote to review, with payment instructions when payable | Acceptance recorded |
| Rejected or expired | Reason or expiry and voucher release status | Order closed |
| Reference submitted or resubmitted | Payment under review | Check reference and amount |
| Payment rejected | Reason and next action | Review outcome recorded |
| Payment acknowledged | Payment acknowledgement | Order updated |
| Dispatched or ready for pickup | Handover instructions and receipt confirmation | Status recorded |
| Before auto-completion | Deadline and problem-reporting option | |
| Completed | Order closure and any earned Miles | Order closure |
| Dispute opened or resolved | Case and next action | Case and next action |

Send reminders and state-change notifications once per event. Keep references and PINs in authenticated order details. Test concurrent reference submissions, stock and price changes, duplicate client requests, PIN guessing and reuse, timeout races with disputes, and voucher and Miles replay across both payment options.

## Phase 1 · Merchant shop and order flow

- **Merchant page.** Add a **Shop** tab and open it by default for ordering-enabled merchants with active products. Reuse gallery photos in the product editor. A product opens a sheet with details, quantity and **Add to order**. Make **Order** the primary QuickActions button for online businesses with ordering enabled.
- **Order review.** Add hidden `orders/new` and `orders/[id]` routes, following the offers and gifts pattern. Preserve the existing tab bar and support direct links from push and Activity. The new-order screen shows items, quantity, pickup or delivery and its fee, eligible owned vouchers, payment method, total, and estimated merchant-funded Miles. Label the M-Pesa option **Pay after merchant accepts** and submit with **Send order**. The quote, voucher eligibility and Miles estimate are validated server-side.
- **Order detail.** Show the available next action for the current state. Let the buyer cancel while awaiting the merchant. Once payable, show the merchant's payment instructions with copy controls and a field for the reference. Show **Payment sent** during review. After dispatch, show the PIN and **I received it**. Show Miles on completion once credited. Keep **Report a problem** available during fulfilment and provide a support path for refunds and issues after closure. Phase 2 adds the review prompt once order reviews can be submitted.
- **Explore.** Show one active order card at the top for the most urgent buyer action, with one button that opens the order. Use it for payment or reference submission, PIN display, or receipt confirmation. Keep the existing feed order for Phase 1.
- **Profile and rewards.** Add **Orders** next to Activity and **Order updates** in notification settings. Use the existing push infrastructure and the event matrix above. Order Miles entries identify the order and business and link to order detail. On eligible voucher details, link **Use online at [merchant]** to the shop. Show reservations as **Held for order [reference]**. Keep the delivery PIN in order detail and keep Pass as the in-store QR.
- **Merchant dashboard.** Add a product editor and an orders inbox with **New**, **To confirm payment**, and **To dispatch**. Include quote acceptance or revision, payment review, dispatch, PIN entry, and issue follow-up.
- **API and database.** Add product and order APIs under Hub `/api/v1` and corresponding native contracts in `akiba-app/src/contracts`. Cover creation and quote acceptance, reference submission and review, fulfilment, receipt confirmation, disputes, history, and the next buyer action. Add an explicit online eligibility flag to voucher templates, defaulting off. Enforce merchant funding and online eligibility on the server for this channel. Review shared database functions and reward, voucher, and visit-evidence consumers with Akiba-Platform before migration.

## Phase 2 · Product discovery and reviews

- **Explore and search.** Add a **Shop online** product row below **Verified visits** in the pilot, with product photo, price, business name, **Delivers** or **Pickup**, and estimated Miles where applicable. Extend `/api/v1/home` with a products section and group search results under **Places** and **Products**. Use discovery and conversion data to decide whether to move the row.
- **Places.** Add an **Order in app** filter alongside the existing operating-model filters. Use ordering capability for the filter, since a business can be online without taking orders in Akiba. Add a compact **Delivers** or **Order** badge to eligible directory cards.
- **Merchant page.** Prompt eligible buyers to review completed orders. Display **Reviews from completed orders** on online merchant pages. Keep the Verified tab tied to in-store evidence and exclude online orders from verified visits and in-store recommendations.
