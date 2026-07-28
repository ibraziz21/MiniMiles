-- Reward accrue/release policy, unified across hub-page and react-app
-- (order-lifecycle-completion-spec.md §6, build order step 4).
--
-- react-app already does something close to this (reward enqueued after
-- delivery confirmation via its own ledger, order only marked 'completed'
-- once that succeeds). Hub-page is the divergent one: it calls Platform's
-- purchase-events API (sendPurchaseEvent) immediately at order creation,
-- with no relationship to delivery/completion at all.
--
-- pending_reward_payload stores the exact PurchaseEventPayload hub-page
-- would have sent at creation time, so the deferred release (at 'completed')
-- can replay it verbatim instead of trying to reconstruct amount/currency/
-- recipient from the order row later -- which loses fidelity, especially
-- across the admin-dashboard -> hub-page boundary for digital orders.

ALTER TABLE merchant_transactions
  ADD COLUMN IF NOT EXISTS pending_reward_payload jsonb;

NOTIFY pgrst, 'reload schema';
