-- Guarded admin operation for short onboarding trials.
-- The UI defaults to two days; callers may choose 1–30 days.

CREATE OR REPLACE FUNCTION admin_grant_partner_trial(
  p_partner_id uuid,
  p_admin_id uuid,
  p_days integer DEFAULT 2
)
RETURNS TABLE (
  ok boolean,
  error_code text,
  subscription_id uuid,
  status text,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription partner_subscriptions%ROWTYPE;
  v_defaults subscription_plan_defaults%ROWTYPE;
  v_start timestamptz := now();
  v_end timestamptz;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN
    RETURN QUERY SELECT false, 'INVALID_TRIAL_DAYS', NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id) THEN
    RETURN QUERY SELECT false, 'PARTNER_NOT_FOUND', NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  -- Serialize grants per merchant so double-clicks cannot create two subscriptions.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_partner_id::text, 0));
  v_end := v_start + make_interval(days => p_days);

  SELECT * INTO v_subscription
  FROM partner_subscriptions
  WHERE partner_id = p_partner_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_subscription.status IN ('active', 'past_due') THEN
    RETURN QUERY SELECT false, 'PAID_SUBSCRIPTION_EXISTS', v_subscription.id, v_subscription.status, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF FOUND AND v_subscription.status NOT IN ('trialing', 'pending_payment') THEN
    RETURN QUERY SELECT false, 'SUBSCRIPTION_NOT_ELIGIBLE', v_subscription.id, v_subscription.status, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE partner_subscriptions
    SET status = 'trialing',
        period_start = v_start,
        period_end = v_end,
        miles_issued_current_period = 0,
        overage_miles_current_period = 0,
        updated_at = now(),
        version = version + 1
    WHERE id = v_subscription.id
    RETURNING * INTO v_subscription;
  ELSE
    SELECT * INTO v_defaults
    FROM subscription_plan_defaults
    WHERE plan = 'basic'
      AND active = true
      AND effective_from <= now()
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY version DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'PLAN_DEFAULTS_NOT_FOUND', NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz;
      RETURN;
    END IF;

    INSERT INTO partner_subscriptions (
      partner_id, plan, status, monthly_miles_quota, included_monthly_miles,
      miles_issued_current_period, overage_miles_current_period,
      period_start, period_end, product_limit, voucher_limit, quest_limit,
      staff_seat_limit, overage_rate_kes_per_mile, overage_rate_kes_snapshot,
      monthly_base_price_kes_snapshot
    ) VALUES (
      p_partner_id, 'basic', 'trialing',
      COALESCE(v_defaults.monthly_miles_quota, v_defaults.included_monthly_miles),
      COALESCE(v_defaults.included_monthly_miles, v_defaults.monthly_miles_quota),
      0, 0, v_start, v_end, v_defaults.product_limit, v_defaults.voucher_limit,
      v_defaults.quest_limit, v_defaults.staff_seat_limit,
      v_defaults.overage_rate_kes_per_mile, v_defaults.overage_rate_kes_per_mile,
      v_defaults.monthly_base_price_kes
    )
    RETURNING * INTO v_subscription;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_subscription.id, v_subscription.status, v_start, v_end;
END;
$$;

COMMENT ON FUNCTION admin_grant_partner_trial(uuid, uuid, integer) IS
  'Grants or resets a 1-30 day onboarding trial; service-role Admin use only.';

REVOKE ALL ON FUNCTION admin_grant_partner_trial(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_grant_partner_trial(uuid, uuid, integer) TO service_role;
