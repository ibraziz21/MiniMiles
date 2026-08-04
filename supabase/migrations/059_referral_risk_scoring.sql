-- 059_referral_risk_scoring.sql
-- Soft risk scoring (referral-system-spec.md §10.2/§10.3) — the deterministic
-- signals that were deliberately deferred from 053 ("only the explicit §10.1
-- hard blocks are implemented"). The hub_referrals.risk_score/risk_decision/
-- risk_reason_codes columns have existed since 053 and the admin review
-- queue/lookup pages have displayed them since Phase D — this migration is
-- what actually populates them.
--
-- Scored at the two points real financial commitment happens:
--   1. Bind time (create_or_get_hub_pass_with_referral) — signals available
--      the instant a referral is created: shared device/IP, disposable/
--      high-velocity email domain, reciprocal referral graph.
--   2. Qualification time (qualify_referral_activation) — accumulates onto
--      the bind-time score with the one new signal available by then:
--      implausibly fast activation after Pass creation.
--
-- V1 scope, deliberately narrower than every §10.2 bullet: "multiple
-- accounts using the same merchant, device or funding source" (needs
-- payment-rail correlation not built here), "repeated failed OTP/account-
-- switch behavior" (Supabase auth doesn't expose OTP failure counts to any
-- app-level table), and "unusual concentration against one voucher
-- program" (needs a voucher-template join) are not implemented — flagging
-- rather than faking them.
--
-- §10.3 actions: 0-29 allow (no change), 30-59 extends the relevant hold
-- (2x, configurable) and sets risk_decision='review' for visibility, 60+
-- routes the job straight to manual_review ("block pending Ops review")
-- without ever touching pending_hold/eligible — the same admin_requeue_
-- referral_reward_job path (055/056) already releases it once cleared.
--
-- "A rule change must not silently rewrite historical decisions" (§10.2) is
-- satisfied by reusing program-version immutability: weights are read from
-- referral_program_versions.rules (an existing, unused-until-now column),
-- and every referral is permanently pinned to the rules in effect on its
-- own program_version_id — a later published version's rules can never
-- reach back and re-score an old referral.

-- ── referral_risk_weight — reads a weight override from a program
--    version's `rules` jsonb, falling back to a documented default. ─────

CREATE OR REPLACE FUNCTION referral_risk_weight(p_rules jsonb, p_key text, p_default integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((p_rules -> 'riskWeights' ->> p_key)::integer, p_default);
$$;

REVOKE ALL ON FUNCTION referral_risk_weight(jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION referral_risk_weight(jsonb, text, integer) TO service_role;

-- ── referral_risk_decision — the fixed §10.3 tier boundaries. Not made
--    configurable like the weights: these three bands (allow/review/block)
--    are the V1 state machine itself, not a tunable parameter. ──────────

CREATE OR REPLACE FUNCTION referral_risk_decision(p_score integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_score >= 60 THEN 'block' WHEN p_score >= 30 THEN 'review' ELSE 'allow' END;
$$;

REVOKE ALL ON FUNCTION referral_risk_decision(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION referral_risk_decision(integer) TO service_role;

-- ── is_disposable_email_domain — small static starting list. Not
--    versioned/configurable in V1; extend this list directly in a future
--    migration as new domains are seen (matches how the rest of this
--    codebase handles small allow/block lists — no admin CRUD for it yet). ──

CREATE OR REPLACE FUNCTION is_disposable_email_domain(p_domain text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_domain = ANY(ARRAY[
    'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
    'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'getnada.com',
    'fakeinbox.com', 'sharklasers.com', 'maildrop.cc', 'dispostable.com',
    'temp-mail.org', 'mintemail.com', 'mohmal.com', 'discard.email',
    'moakt.com', 'emailondeck.com'
  ]);
$$;

REVOKE ALL ON FUNCTION is_disposable_email_domain(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_disposable_email_domain(text) TO service_role;

-- ── create_or_get_hub_pass_with_referral (057): score at bind time ───────

CREATE OR REPLACE FUNCTION create_or_get_hub_pass_with_referral(
  p_user_id              uuid,
  p_email                text,
  p_src                  text DEFAULT 'organic',
  p_referral_token_hash  text DEFAULT NULL
) RETURNS TABLE(public_pass_id uuid, is_new boolean, referral_outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing         uuid;
  v_inserted         uuid;
  v_pass_created_at  timestamptz;
  v_outcome          text := 'none';
  v_click            referral_clicks%ROWTYPE;
  v_program          referral_program_versions%ROWTYPE;
  v_code             hub_referral_codes%ROWTYPE;
  v_referrer_id      uuid;
  v_referral_id      uuid;
  v_total_reserve    integer;
  v_signup_key       text;
  v_email_domain     text;
  v_risk_score       integer := 0;
  v_risk_reasons     text[] := '{}';
  v_risk_decision    text;
  v_shared_device_count  integer;
  v_domain_velocity_count integer;
  v_hold_multiplier  integer;
  v_signup_status    text;
BEGIN
  SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false, 'none'::text;
    RETURN;
  END IF;

  INSERT INTO hub_user_passes (user_id, email, signup_src)
  VALUES (p_user_id, p_email, p_src)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING hub_user_passes.public_pass_id, hub_user_passes.created_at INTO v_inserted, v_pass_created_at;

  IF v_inserted IS NULL THEN
    SELECT hup.public_pass_id INTO v_existing FROM hub_user_passes hup WHERE hup.user_id = p_user_id;
    RETURN QUERY SELECT v_existing, false, 'none'::text;
    RETURN;
  END IF;

  INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
  VALUES (
    'pass_activated',
    'pass:' || p_user_id::text,
    jsonb_build_array(jsonb_build_object('type', 'email', 'value', p_email)),
    jsonb_build_object('src', p_src, 'userId', p_user_id)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF p_referral_token_hash IS NULL THEN
    RETURN QUERY SELECT v_inserted, true, 'none'::text;
    RETURN;
  END IF;

  BEGIN
    IF NOT referral_flag_enabled('bind_referrals') THEN
      v_outcome := 'program_paused';
    ELSE
      SELECT * INTO v_click FROM referral_clicks
      WHERE token_hash = p_referral_token_hash AND status = 'accepted'
      FOR UPDATE;

      IF NOT FOUND THEN
        v_outcome := 'not_eligible';
      ELSIF v_click.expires_at <= now() THEN
        UPDATE referral_clicks SET status = 'expired' WHERE id = v_click.id;
        v_outcome := 'not_eligible';
      ELSE
        SELECT * INTO v_program FROM referral_program_versions WHERE id = v_click.program_version_id FOR UPDATE;
        SELECT * INTO v_code FROM hub_referral_codes WHERE id = v_click.referral_code_id FOR UPDATE;
        v_referrer_id := v_code.hub_user_id;

        IF v_program.status <> 'active' THEN
          v_outcome := 'program_paused';
        ELSIF v_code.status <> 'active' THEN
          v_outcome := 'not_eligible';
        ELSIF v_referrer_id = p_user_id THEN
          v_outcome := 'not_eligible';
        ELSIF EXISTS (
          SELECT 1 FROM hub_user_wallets w1
          JOIN hub_user_wallets w2 ON lower(w1.address) = lower(w2.address)
          WHERE w1.user_id = p_user_id AND w1.verification_status = 'verified'
            AND w2.user_id = v_referrer_id AND w2.verification_status = 'verified'
        ) THEN
          v_outcome := 'not_eligible';
        ELSIF NOT EXISTS (SELECT 1 FROM hub_user_passes WHERE user_id = v_referrer_id) THEN
          v_outcome := 'not_eligible';
        ELSIF EXISTS (
          SELECT 1 FROM hub_user_risk_flags
          WHERE hub_user_id = v_referrer_id AND is_active
            AND flag_type IN ('blacklisted', 'rewards_disabled')
        ) THEN
          v_outcome := 'not_eligible';
        ELSIF (
          SELECT count(*) FROM hub_referrals
          WHERE referrer_user_id = v_referrer_id AND created_at >= now() - interval '24 hours'
        ) >= v_program.daily_signup_cap THEN
          v_outcome := 'not_eligible';
        ELSIF (
          SELECT count(*) FROM hub_referrals
          WHERE referrer_user_id = v_referrer_id AND created_at >= now() - interval '30 days'
        ) >= v_program.rolling_30_day_referral_cap THEN
          v_outcome := 'not_eligible';
        ELSIF NOT (
          (SELECT created_at FROM hub_user_passes WHERE user_id = v_referrer_id) <= now() - interval '7 days'
          OR EXISTS (SELECT 1 FROM voucher_redemptions WHERE hub_user_id = v_referrer_id)
          OR EXISTS (
            SELECT 1 FROM reward_jobs rj JOIN merchant_transactions mt ON mt.id = rj.order_id
            WHERE rj.status = 'released' AND resolve_hub_user_id_from_address(mt.user_address) = v_referrer_id
          )
        ) THEN
          v_outcome := 'not_eligible';
        ELSE
          v_total_reserve := v_program.signup_reward_miles + v_program.activation_reward_miles;
          IF v_program.total_budget_miles - v_program.reserved_budget_miles - v_program.released_budget_miles < v_total_reserve THEN
            v_outcome := 'budget_exhausted';
          ELSE
            -- ── Soft risk scoring (§10.2) ──────────────────────────────
            v_email_domain := lower(split_part(p_email, '@', 2));

            SELECT count(*) INTO v_shared_device_count
            FROM hub_referrals r2
            JOIN referral_clicks c2 ON c2.id = r2.referral_click_id
            WHERE r2.created_at >= now() - interval '24 hours'
              AND (
                (v_click.device_hash IS NOT NULL AND c2.device_hash = v_click.device_hash)
                OR (v_click.ip_hash IS NOT NULL AND c2.ip_hash = v_click.ip_hash)
              );

            IF v_shared_device_count >= 3 THEN
              v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'shared_device_cluster', 40);
              v_risk_reasons := array_append(v_risk_reasons, 'shared_device_cluster');
            ELSIF v_shared_device_count >= 1 THEN
              v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'shared_device_seen', 15);
              v_risk_reasons := array_append(v_risk_reasons, 'shared_device_seen');
            END IF;

            IF is_disposable_email_domain(v_email_domain) THEN
              v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'disposable_email_domain', 35);
              v_risk_reasons := array_append(v_risk_reasons, 'disposable_email_domain');
            ELSIF v_email_domain NOT IN (
              'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com'
            ) THEN
              SELECT count(*) INTO v_domain_velocity_count
              FROM hub_user_passes hup
              WHERE hup.created_at >= now() - interval '24 hours'
                AND lower(split_part(hup.email, '@', 2)) = v_email_domain;

              IF v_domain_velocity_count >= 5 THEN
                v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'high_velocity_email_domain', 25);
                v_risk_reasons := array_append(v_risk_reasons, 'high_velocity_email_domain');
              END IF;
            END IF;

            IF EXISTS (
              SELECT 1 FROM hub_referrals WHERE referrer_user_id = p_user_id AND referred_user_id = v_referrer_id
            ) THEN
              v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'reciprocal_referral_pattern', 50);
              v_risk_reasons := array_append(v_risk_reasons, 'reciprocal_referral_pattern');
            END IF;

            v_risk_decision := referral_risk_decision(v_risk_score);
            v_hold_multiplier := CASE WHEN v_risk_decision = 'review' THEN 2 ELSE 1 END;
            v_signup_status := CASE WHEN v_risk_decision = 'block' THEN 'manual_review' ELSE 'pending_hold' END;

            UPDATE referral_program_versions
            SET reserved_budget_miles = reserved_budget_miles + v_total_reserve
            WHERE id = v_program.id;

            INSERT INTO hub_referrals (
              program_version_id, referral_code_id, referral_click_id,
              referrer_user_id, referred_user_id, referred_pass_id,
              status, signup_reward_miles, activation_reward_miles, min_purchase_kes,
              activation_expires_at, risk_score, risk_decision, risk_reason_codes
            ) VALUES (
              v_program.id, v_code.id, v_click.id,
              v_referrer_id, p_user_id, v_inserted,
              CASE WHEN v_risk_decision = 'block' THEN 'manual_review' ELSE 'pass_activated' END,
              v_program.signup_reward_miles, v_program.activation_reward_miles,
              v_program.min_purchase_kes,
              v_pass_created_at + make_interval(days => v_program.activation_window_days),
              v_risk_score, v_risk_decision, v_risk_reasons
            )
            RETURNING id INTO v_referral_id;

            v_signup_key := 'hub-referral:' || v_program.version::text || ':' || v_referral_id::text || ':signup:referrer';

            INSERT INTO referral_reward_jobs (
              referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at, status
            ) VALUES (
              v_referral_id, 'signup', v_referrer_id, v_program.signup_reward_miles, v_signup_key,
              now() + make_interval(hours => v_program.signup_hold_hours * v_hold_multiplier),
              v_signup_status
            );

            UPDATE referral_clicks SET status = 'bound', bound_at = now() WHERE id = v_click.id;

            INSERT INTO referral_events (referral_id, referral_click_id, actor_type, event_type, to_state, metadata)
            VALUES (
              v_referral_id, v_click.id, 'system', 'referral_bound', 'pass_activated',
              jsonb_build_object('referrerUserId', v_referrer_id, 'programVersionId', v_program.id)
            );
            IF v_risk_score > 0 THEN
              INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
              VALUES (
                v_referral_id, 'system', 'referral_risk_scored', v_risk_decision,
                jsonb_build_object('score', v_risk_score, 'reasons', to_jsonb(v_risk_reasons))
              );
            END IF;
            INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
            VALUES (v_referral_id, 'system', 'referral_signup_reward_held', v_signup_status);

            PERFORM notify_referral_event(
              v_referrer_id, 'referral_signup_held',
              'notif:referral:' || v_referral_id::text || ':signup:held',
              jsonb_build_object('referralId', v_referral_id)
            );

            v_outcome := 'bound';
          END IF;
        END IF;

        IF v_outcome <> 'bound' THEN
          UPDATE referral_clicks SET status = 'blocked' WHERE id = v_click.id AND status = 'accepted';
          INSERT INTO referral_events (referral_click_id, actor_type, event_type, reason_code)
          VALUES (v_click.id, 'system', 'referral_click_blocked', v_outcome);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral binding failed for user %: %', p_user_id, SQLERRM;
    v_outcome := 'none';
  END;

  RETURN QUERY SELECT v_inserted, true, v_outcome;
END;
$$;

-- ── qualify_referral_activation (057): re-score at qualification time,
--    accumulating onto the bind-time score. ──────────────────────────────

CREATE OR REPLACE FUNCTION qualify_referral_activation(
  p_referred_user_id          uuid,
  p_qualification_type        text,
  p_qualification_reference   text,
  p_gross_amount_kes          numeric,
  p_occurred_at               timestamptz DEFAULT now()
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referral        hub_referrals%ROWTYPE;
  v_program         referral_program_versions%ROWTYPE;
  v_pass_created_at timestamptz;
  v_activation_key  text;
  v_risk_score      integer;
  v_risk_reasons    text[];
  v_risk_decision   text;
  v_hold_multiplier integer;
  v_activation_status text;
BEGIN
  IF NOT referral_flag_enabled('qualify_activations') THEN
    RETURN QUERY SELECT false, 'program_paused'::text; RETURN;
  END IF;

  IF p_qualification_type NOT IN ('hub_purchase', 'merchant_purchase', 'voucher_redemption') THEN
    RETURN QUERY SELECT false, 'invalid_type'::text; RETURN;
  END IF;

  SELECT * INTO v_referral FROM hub_referrals WHERE referred_user_id = p_referred_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_referral'::text; RETURN;
  END IF;

  IF v_referral.status IN ('qualified', 'complete') THEN
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;

  -- A referral already routed to manual_review by bind-time scoring stays
  -- there for an admin to clear (requeue) before it can qualify further —
  -- matches "score 60+ block pending Ops review" rather than letting a
  -- qualifying purchase silently un-block it.
  IF v_referral.status <> 'pass_activated' THEN
    RETURN QUERY SELECT false, 'referral_not_eligible'::text; RETURN;
  END IF;

  SELECT created_at INTO v_pass_created_at FROM hub_user_passes WHERE id = v_referral.referred_pass_id;
  IF p_occurred_at < v_pass_created_at THEN
    RETURN QUERY SELECT false, 'predates_pass_creation'::text; RETURN;
  END IF;

  IF v_referral.activation_expires_at < now() THEN
    RETURN QUERY SELECT false, 'activation_window_expired'::text; RETURN;
  END IF;

  IF p_gross_amount_kes IS NULL OR p_gross_amount_kes < v_referral.min_purchase_kes THEN
    RETURN QUERY SELECT false, 'below_threshold'::text; RETURN;
  END IF;

  SELECT * INTO v_program FROM referral_program_versions WHERE id = v_referral.program_version_id;

  -- ── Re-score: accumulate the one new signal available at qualification
  --    time onto whatever bind-time scoring already found. ───────────────
  v_risk_score := v_referral.risk_score;
  v_risk_reasons := v_referral.risk_reason_codes;

  IF p_occurred_at - v_pass_created_at < interval '10 minutes' THEN
    v_risk_score := v_risk_score + referral_risk_weight(v_program.rules, 'rapid_activation_velocity', 30);
    v_risk_reasons := array_append(v_risk_reasons, 'rapid_activation_velocity');
  END IF;

  v_risk_decision := referral_risk_decision(v_risk_score);
  v_hold_multiplier := CASE WHEN v_risk_decision = 'review' THEN 2 ELSE 1 END;
  v_activation_status := CASE WHEN v_risk_decision = 'block' THEN 'manual_review' ELSE 'pending_hold' END;

  BEGIN
    UPDATE hub_referrals
    SET status = CASE WHEN v_risk_decision = 'block' THEN 'manual_review' ELSE 'qualified' END,
        qualification_type = p_qualification_type,
        qualification_reference = p_qualification_reference,
        qualified_at = now(),
        risk_score = v_risk_score, risk_decision = v_risk_decision, risk_reason_codes = v_risk_reasons,
        updated_at = now()
    WHERE id = v_referral.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'duplicate_proof'::text; RETURN;
  END;

  v_activation_key := 'hub-referral:' || v_program.version::text || ':' || v_referral.id::text || ':activation:referrer';

  INSERT INTO referral_reward_jobs (
    referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at, status
  ) VALUES (
    v_referral.id, 'activation', v_referral.referrer_user_id, v_referral.activation_reward_miles, v_activation_key,
    now() + make_interval(hours => v_program.activation_hold_hours * v_hold_multiplier),
    v_activation_status
  )
  ON CONFLICT (referral_id, milestone) DO NOTHING;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, metadata)
  VALUES (
    v_referral.id, 'system', 'referral_qualified', 'pass_activated',
    CASE WHEN v_risk_decision = 'block' THEN 'manual_review' ELSE 'qualified' END,
    jsonb_build_object(
      'qualificationType', p_qualification_type,
      'qualificationReference', p_qualification_reference,
      'grossAmountKes', p_gross_amount_kes
    )
  );
  IF v_risk_score > v_referral.risk_score THEN
    INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
    VALUES (
      v_referral.id, 'system', 'referral_risk_scored', v_risk_decision,
      jsonb_build_object('score', v_risk_score, 'reasons', to_jsonb(v_risk_reasons))
    );
  END IF;
  INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
  VALUES (v_referral.id, 'system', 'referral_activation_reward_held', v_activation_status);

  PERFORM notify_referral_event(
    v_referral.referrer_user_id, 'referral_activation_held',
    'notif:referral:' || v_referral.id::text || ':activation:held',
    jsonb_build_object('referralId', v_referral.id)
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

NOTIFY pgrst, 'reload schema';
