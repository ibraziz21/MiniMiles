-- 060_referral_launch_hardening.sql
-- Forward-only hardening for environments where 053-059 have already run.
-- Do not fold these changes back into an applied migration: Supabase will not
-- replay an old migration merely because its file changed.

-- Published terms stay immutable while active, paused, or ended.
CREATE OR REPLACE FUNCTION enforce_referral_program_version_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('active', 'paused', 'ended') THEN
    IF NEW.status NOT IN ('active', 'paused', 'ended') THEN
      RAISE EXCEPTION 'referral_program_versions: invalid status transition' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.signup_reward_miles          IS DISTINCT FROM OLD.signup_reward_miles OR
       NEW.activation_reward_miles      IS DISTINCT FROM OLD.activation_reward_miles OR
       NEW.attribution_window_days      IS DISTINCT FROM OLD.attribution_window_days OR
       NEW.activation_window_days       IS DISTINCT FROM OLD.activation_window_days OR
       NEW.signup_hold_hours            IS DISTINCT FROM OLD.signup_hold_hours OR
       NEW.activation_hold_hours        IS DISTINCT FROM OLD.activation_hold_hours OR
       NEW.min_purchase_kes             IS DISTINCT FROM OLD.min_purchase_kes OR
       NEW.daily_signup_cap             IS DISTINCT FROM OLD.daily_signup_cap OR
       NEW.rolling_30_day_referral_cap  IS DISTINCT FROM OLD.rolling_30_day_referral_cap OR
       NEW.total_budget_miles           IS DISTINCT FROM OLD.total_budget_miles OR
       NEW.starts_at                    IS DISTINCT FROM OLD.starts_at OR
       NEW.rules                        IS DISTINCT FROM OLD.rules
    THEN
      RAISE EXCEPTION 'referral_program_versions: financial settings are immutable once published' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_program_versions_immutable ON referral_program_versions;
CREATE TRIGGER trg_referral_program_versions_immutable
  BEFORE UPDATE ON referral_program_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_referral_program_version_immutability();

-- A reversal request must stop the member UI saying "complete" immediately,
-- not only after Platform confirms the compensating debit.
CREATE OR REPLACE FUNCTION mark_referral_review_on_reward_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('reversal_pending', 'reversed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE hub_referrals
    SET status = 'manual_review',
        rejection_reason_code = COALESCE(NEW.last_error_detail, NEW.last_error_code, 'reward_reversal_requested'),
        updated_at = now()
    WHERE id = NEW.referral_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_review_on_reward_reversal ON referral_reward_jobs;
CREATE TRIGGER trg_referral_review_on_reward_reversal
  AFTER UPDATE OF status ON referral_reward_jobs
  FOR EACH ROW EXECUTE FUNCTION mark_referral_review_on_reward_reversal();

-- released_budget_miles represents credits still outstanding on Platform.
-- A released job remains outstanding while its reversal is pending/processing;
-- it stops counting only after reversed_at is confirmed.
CREATE OR REPLACE VIEW v_referral_budget_discrepancies AS
SELECT
  pv.id AS program_version_id,
  pv.version,
  pv.status,
  pv.released_budget_miles AS recorded_released,
  COALESCE(SUM(j.amount_miles) FILTER (
    WHERE j.released_at IS NOT NULL AND j.reversed_at IS NULL
  ), 0) AS actual_released,
  pv.released_budget_miles - COALESCE(SUM(j.amount_miles) FILTER (
    WHERE j.released_at IS NOT NULL AND j.reversed_at IS NULL
  ), 0) AS discrepancy
FROM referral_program_versions pv
LEFT JOIN hub_referrals r ON r.program_version_id = pv.id
LEFT JOIN referral_reward_jobs j ON j.referral_id = r.id
GROUP BY pv.id, pv.version, pv.status, pv.released_budget_miles
HAVING pv.released_budget_miles <> COALESCE(SUM(j.amount_miles) FILTER (
  WHERE j.released_at IS NOT NULL AND j.reversed_at IS NULL
), 0);

-- One authoritative read contract for the invite UI. This mirrors the hard
-- checks in create_or_get_hub_pass_with_referral instead of approximating them
-- in TypeScript.
CREATE OR REPLACE FUNCTION get_referral_invite_eligibility(p_user_id uuid)
RETURNS TABLE(can_earn boolean, reason text, remaining_rewarded_referrals integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_program referral_program_versions%ROWTYPE;
  v_pass_created_at timestamptz;
  v_daily_count integer := 0;
  v_rolling_count integer := 0;
  v_budget_remaining bigint := 0;
  v_reward_per_referral integer := 0;
  v_budget_capacity integer := 0;
  v_remaining integer := 0;
BEGIN
  SELECT * INTO v_program
  FROM referral_program_versions
  WHERE status = 'active'
  LIMIT 1;

  IF NOT FOUND OR NOT referral_flag_enabled('bind_referrals') THEN
    RETURN QUERY SELECT false, 'program_paused'::text, 0;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_daily_count
  FROM hub_referrals
  WHERE referrer_user_id = p_user_id AND created_at >= now() - interval '24 hours';

  SELECT count(*)::integer INTO v_rolling_count
  FROM hub_referrals
  WHERE referrer_user_id = p_user_id AND created_at >= now() - interval '30 days';

  v_reward_per_referral := v_program.signup_reward_miles + v_program.activation_reward_miles;
  v_budget_remaining := v_program.total_budget_miles - v_program.reserved_budget_miles - v_program.released_budget_miles;
  v_budget_capacity := CASE
    WHEN v_reward_per_referral > 0 THEN floor(v_budget_remaining::numeric / v_reward_per_referral)::integer
    ELSE 0
  END;
  v_remaining := GREATEST(0, LEAST(
    v_program.daily_signup_cap - v_daily_count,
    v_program.rolling_30_day_referral_cap - v_rolling_count,
    v_budget_capacity
  ));

  SELECT created_at INTO v_pass_created_at FROM hub_user_passes WHERE user_id = p_user_id;
  IF v_pass_created_at IS NULL THEN
    RETURN QUERY SELECT false, 'account_not_active'::text, v_remaining;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM hub_user_risk_flags
    WHERE hub_user_id = p_user_id AND is_active
      AND flag_type IN ('blacklisted', 'rewards_disabled')
  ) THEN
    RETURN QUERY SELECT false, 'account_not_active'::text, 0;
    RETURN;
  END IF;

  IF NOT (
    v_pass_created_at <= now() - interval '7 days'
    OR EXISTS (SELECT 1 FROM voucher_redemptions WHERE hub_user_id = p_user_id)
    OR EXISTS (
      SELECT 1 FROM reward_jobs rj
      JOIN merchant_transactions mt ON mt.id = rj.order_id
      WHERE rj.status = 'released'
        AND resolve_hub_user_id_from_address(mt.user_address) = p_user_id
    )
  ) THEN
    RETURN QUERY SELECT false, 'account_not_active'::text, v_remaining;
    RETURN;
  END IF;

  IF v_daily_count >= v_program.daily_signup_cap
     OR v_rolling_count >= v_program.rolling_30_day_referral_cap THEN
    RETURN QUERY SELECT false, 'limit_reached'::text, 0;
    RETURN;
  END IF;

  IF v_budget_capacity <= 0 THEN
    RETURN QUERY SELECT false, 'program_paused'::text, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION get_referral_invite_eligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_referral_invite_eligibility(uuid) TO service_role;

-- Replace the in-store redemption RPC with a six-argument version. The
-- referral candidate is written to the existing durable outbox in the same
-- transaction as the redemption, while qualification itself remains off the
-- merchant's critical path and retries through the outbox worker.
DROP FUNCTION IF EXISTS redeem_voucher_in_store_atomic(text, uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS redeem_voucher_in_store_atomic(text, uuid, uuid, numeric, text, numeric);

CREATE OR REPLACE FUNCTION redeem_voucher_in_store_atomic(
  p_token_hash text,
  p_partner_id uuid,
  p_merchant_user_id uuid,
  p_gross_amount_cusd numeric,
  p_external_reference text DEFAULT NULL,
  p_gross_amount_kes numeric DEFAULT NULL
) RETURNS TABLE(
  ok boolean, voucher_id uuid, offer_title text, error_code text,
  hub_user_id uuid, gross_amount_cusd numeric, referral_qualifying boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_iv record; v_discount numeric; v_redemption_id uuid; v_title text; v_identities jsonb;
  v_referral_qualifying boolean := false;
  v_qualification_type text;
BEGIN
  SELECT * INTO v_iv FROM issued_vouchers
   WHERE redemption_token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_iv.status<>'issued'
     OR v_iv.redemption_token_expires_at IS NULL
     OR v_iv.redemption_token_expires_at<now()
     OR v_iv.merchant_id IS DISTINCT FROM p_partner_id THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text,NULL::uuid,NULL::numeric,false; RETURN;
  END IF;
  IF v_iv.expires_at IS NOT NULL AND v_iv.expires_at<now() THEN
    UPDATE issued_vouchers SET status='expired' WHERE id=v_iv.id;
    INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id)
    VALUES(v_iv.id,'expired',p_merchant_user_id::text);
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,'INVALID'::text,NULL::uuid,NULL::numeric,false; RETURN;
  END IF;

  v_discount := calculate_voucher_discount(v_iv.rules_snapshot,p_gross_amount_cusd);
  v_title := v_iv.rules_snapshot->>'title';

  UPDATE issued_vouchers SET status='redeemed',redeemed_at=now() WHERE id=v_iv.id;
  INSERT INTO voucher_redemptions(
    issued_voucher_id,hub_user_id,user_address,merchant_id,discount_applied,
    redemption_channel,merchant_user_id,external_reference,redeemed_at
  ) VALUES(
    v_iv.id,v_iv.hub_user_id,v_iv.user_address,p_partner_id,v_discount,
    'merchant_scan',p_merchant_user_id,p_external_reference,now()
  ) RETURNING id INTO v_redemption_id;

  PERFORM create_voucher_payable(
    v_iv.id,v_redemption_id,p_gross_amount_cusd,v_discount,
    'redemption:'||v_redemption_id::text,
    jsonb_build_object('channel','merchant_scan','external_reference',p_external_reference)
  );

  INSERT INTO voucher_events(issued_voucher_id,event_type,actor_id,metadata)
  VALUES(v_iv.id,'redeemed',p_merchant_user_id::text,
    jsonb_build_object('merchant_id',p_partner_id,'channel','merchant_scan',
                       'gross_amount_cusd',p_gross_amount_cusd,'discount_applied',v_discount));
  INSERT INTO merchant_audit_log(merchant_user_id,partner_id,action,metadata)
  VALUES(p_merchant_user_id,p_partner_id,'voucher.redeemed',
    jsonb_build_object('voucher_id',v_iv.id,'channel','merchant_scan','discount_applied',v_discount));

  IF v_iv.user_address IS NOT NULL THEN
    v_identities := jsonb_build_array(jsonb_build_object('type','wallet','value',lower(v_iv.user_address)));
    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'voucher_redeemed', 'vredeem:' || v_iv.id::text, v_identities,
      jsonb_build_object('voucher_id',v_iv.id,'merchant_id',p_partner_id,'acquisition_source',v_iv.acquisition_source)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT COALESCE(svt.referral_qualifying, false) INTO v_referral_qualifying
  FROM spend_voucher_templates svt WHERE svt.id = v_iv.voucher_template_id;

  IF v_iv.hub_user_id IS NOT NULL AND p_gross_amount_kes IS NOT NULL THEN
    v_qualification_type := CASE WHEN v_referral_qualifying THEN 'voucher_redemption' ELSE 'merchant_purchase' END;
    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'referral_activation_candidate',
      'refqual:instore:' || v_iv.id::text,
      '[]'::jsonb,
      jsonb_build_object(
        'referredUserId', v_iv.hub_user_id,
        'qualificationType', v_qualification_type,
        'qualificationReference', 'instore:' || v_iv.id::text,
        'grossAmountKes', p_gross_amount_kes
      )
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT true,v_iv.id,v_title,''::text,v_iv.hub_user_id,p_gross_amount_cusd,v_referral_qualifying;
END;
$$;

REVOKE ALL ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION redeem_voucher_in_store_atomic(text,uuid,uuid,numeric,text,numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
