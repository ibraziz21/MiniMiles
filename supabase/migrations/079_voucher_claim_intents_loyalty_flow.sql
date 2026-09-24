-- 079_voucher_claim_intents_loyalty_flow.sql
-- The new loyalty-voucher claim proxy route (app/api/shop/vouchers/loyalty/
-- [templateId]/claim) records intent through the same voucher_claim_intents
-- table as the other two claim flows, for consistency — but 077's flow CHECK
-- only allows 'miles_purchase'/'funded_claim'. Add 'loyalty_claim'.

ALTER TABLE voucher_claim_intents DROP CONSTRAINT IF EXISTS voucher_claim_intents_flow_check;
ALTER TABLE voucher_claim_intents ADD CONSTRAINT voucher_claim_intents_flow_check
  CHECK (flow IN ('miles_purchase', 'funded_claim', 'loyalty_claim'));
