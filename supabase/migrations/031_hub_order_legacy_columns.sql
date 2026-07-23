-- Hub order compatibility and paid-order recovery.
--
-- merchant_transactions predates the Hub checkout flow in production and has
-- required legacy columns. The Phase 4 RPC did not populate them, so a verified
-- external payment could be followed by a rolled-back order insert.

DROP FUNCTION IF EXISTS place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[]
);

CREATE OR REPLACE FUNCTION place_hub_order_and_redeem_voucher(
  p_partner_id uuid,p_user_address text,p_item_name text,p_item_category text,
  p_product_id text,p_payment_ref text,p_payment_currency text,p_payment_method text,
  p_amount_cusd numeric,p_amount_kes integer,p_voucher_code text,p_voucher_id uuid,
  p_recipient_name text,p_phone text,p_city text,p_location_details text,
  p_hub_user_id uuid,p_merchant_id uuid,p_product_id_scope text,p_product_category text,
  p_discount_applied numeric,p_user_addresses text[],
  p_akiba_username text DEFAULT NULL,p_quote_kes integer DEFAULT NULL,
  p_delivery_kes integer DEFAULT NULL,p_discount_kes integer DEFAULT NULL
) RETURNS TABLE(ok boolean,order_id uuid,error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order_id uuid; v_iv record; v_discount numeric; v_gross numeric; v_redemption_id uuid;
  v_snap_product text; v_snap_category text; v_max_discount numeric;
BEGIN
  IF p_amount_cusd IS NULL OR p_amount_cusd < 0 OR p_amount_cusd > 1000000 THEN
    RAISE EXCEPTION 'INVALID_ORDER_AMOUNT' USING ERRCODE='P0001';
  END IF;
  IF p_voucher_id IS NOT NULL THEN
    SELECT * INTO v_iv FROM issued_vouchers WHERE id=p_voucher_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND' USING ERRCODE='P0001'; END IF;
    IF v_iv.status<>'claiming' THEN RAISE EXCEPTION 'WRONG_STATUS' USING ERRCODE='P0001'; END IF;
    IF v_iv.merchant_id IS DISTINCT FROM p_partner_id THEN RAISE EXCEPTION 'WRONG_MERCHANT' USING ERRCODE='P0001'; END IF;
    IF v_iv.hub_user_id IS NOT NULL THEN
      IF p_hub_user_id IS NULL OR v_iv.hub_user_id<>p_hub_user_id THEN RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE='P0001'; END IF;
    ELSIF p_user_addresses IS NULL OR NOT EXISTS(
      SELECT 1 FROM unnest(p_user_addresses) a WHERE lower(a)=lower(v_iv.user_address)
    ) THEN RAISE EXCEPTION 'WRONG_OWNER' USING ERRCODE='P0001';
    END IF;
    v_snap_product:=v_iv.rules_snapshot->>'linked_product_id';
    v_snap_category:=v_iv.rules_snapshot->>'applicable_category';
    IF v_snap_product IS NOT NULL AND v_snap_product<>p_product_id THEN RAISE EXCEPTION 'WRONG_PRODUCT' USING ERRCODE='P0001'; END IF;
    IF v_snap_product IS NULL AND v_snap_category IS NOT NULL AND v_snap_category<>p_item_category THEN RAISE EXCEPTION 'WRONG_CATEGORY' USING ERRCODE='P0001'; END IF;
    v_max_discount:=NULLIF(v_iv.rules_snapshot->>'retail_value_cusd','')::numeric;
    IF v_max_discount IS NOT NULL AND COALESCE(p_discount_applied,0)>v_max_discount+0.005 THEN
      RAISE EXCEPTION 'DISCOUNT_EXCEEDS_CAP' USING ERRCODE='P0001';
    END IF;
    v_gross:=round(p_amount_cusd::numeric+COALESCE(p_discount_applied,0),6);
    v_discount:=calculate_voucher_discount(v_iv.rules_snapshot,v_gross);
    IF abs(v_discount-COALESCE(p_discount_applied,0))>0.005 THEN RAISE EXCEPTION 'DISCOUNT_MISMATCH' USING ERRCODE='P0001'; END IF;
  END IF;

  INSERT INTO merchant_transactions(
    partner_id,akiba_username,user_address,category,action,quote_kes,
    labor_kes,discount_kes,paid_kes,status,item_name,item_category,product_id,payment_ref,
    payment_currency,payment_method,amount_cusd,amount_kes,voucher_code,voucher_id,
    recipient_name,phone,city,location_details
  ) VALUES(
    p_partner_id,
    COALESCE(NULLIF(trim(p_akiba_username),''),NULLIF(trim(p_user_address),''),'hub-user'),
    p_user_address,'general','redeem',COALESCE(p_quote_kes,p_amount_kes,0),
    COALESCE(p_delivery_kes,0),COALESCE(p_discount_kes,0),p_amount_kes,
    'placed',p_item_name,p_item_category,p_product_id,p_payment_ref,
    p_payment_currency,
    CASE
      WHEN p_payment_method IN ('minipay_send','cash','card','other','onchain_transfer')
        THEN p_payment_method::payment_method
      WHEN p_payment_method LIKE 'crypto:%'
        THEN 'onchain_transfer'::payment_method
      ELSE 'other'::payment_method
    END,
    p_amount_cusd,p_amount_kes,p_voucher_code,p_voucher_id,
    p_recipient_name,p_phone,p_city,p_location_details
  ) RETURNING id INTO v_order_id;

  IF p_voucher_id IS NOT NULL THEN
    UPDATE issued_vouchers SET status='redeemed',redeemed_at=now() WHERE id=p_voucher_id;
    INSERT INTO voucher_redemptions(
      issued_voucher_id,order_id,hub_user_id,user_address,merchant_id,product_id,
      discount_applied,redemption_channel,redeemed_at
    ) VALUES(
      p_voucher_id,v_order_id::text,p_hub_user_id,p_user_address,p_partner_id,p_product_id,
      v_discount,'online_order',now()
    ) RETURNING id INTO v_redemption_id;
    PERFORM create_voucher_payable(
      p_voucher_id,v_redemption_id,v_gross,v_discount,'redemption:'||v_redemption_id::text,
      jsonb_build_object('channel','online_order','order_id',v_order_id)
    );
    INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id,metadata)
    VALUES(p_voucher_id,'redeemed',COALESCE(p_hub_user_id::text,p_user_address),
      jsonb_build_object('order_id',v_order_id,'merchant_id',p_partner_id,'discount_applied',v_discount));
  END IF;
  RETURN QUERY SELECT true,v_order_id,''::text;
END;
$$;

REVOKE ALL ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION place_hub_order_and_redeem_voucher(
  uuid,text,text,text,text,text,text,text,numeric,integer,text,uuid,
  text,text,text,text,uuid,uuid,text,text,numeric,text[],text,integer,integer,integer
) TO service_role;

-- Repeated recovery attempts must not create a new open incident for the same
-- verified payment. Preserve the newest row and close older duplicate records
-- before enforcing the invariant.
WITH ranked_incidents AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY type, data->>'payment_ref'
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM reconciliation_incidents
  WHERE type='order_rpc_failed_after_payment'
    AND resolved=false
    AND data->>'payment_ref' IS NOT NULL
)
UPDATE reconciliation_incidents
SET resolved=true
WHERE id IN (
  SELECT id FROM ranked_incidents WHERE duplicate_rank>1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ri_open_order_payment_ref
  ON reconciliation_incidents ((data->>'payment_ref'))
  WHERE type='order_rpc_failed_after_payment'
    AND resolved=false
    AND data->>'payment_ref' IS NOT NULL;

NOTIFY pgrst, 'reload schema';
