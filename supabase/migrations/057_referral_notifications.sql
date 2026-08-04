-- 057_referral_notifications.sql
-- Referral notifications (referral-system-spec.md §12) — the 5 required
-- messages, sent from durable outbox jobs after committed state changes.
--
-- Reuses the existing notification_outbox + web_push_jobs pipeline
-- (047_web_push_notifications.sql) rather than building a third system:
-- inserting into notification_outbox with hub_user_id/category/deep_link
-- set explicitly (the "new producer" path that migration's own comment
-- describes) makes the row show up on /me/notifications immediately, and
-- the existing trg_notification_outbox_enqueue_push trigger auto-creates a
-- web_push_jobs row for it once its template is added to that trigger's
-- whitelist below — no separate referral-specific delivery code needed.
--
-- Every insert happens inside the same transaction as the state change it
-- reports (create_or_get_hub_pass_with_referral, qualify_referral_
-- activation, complete_referral_reward_job, claim_referral_reward_jobs),
-- so a notification can never be lost to a crash between "reward decided"
-- and "notification queued" — and per spec, a notification failure must
-- never roll back a reward; ON CONFLICT (dedupe_key) DO NOTHING is the only
-- "failure" mode this can hit (a replay), which is the desired no-op.
--
-- Dedupe key shape matches spec exactly: "referral ID, milestone, and
-- notification type" -> notif:referral:<referral-id>:<milestone>:<event>.

CREATE OR REPLACE FUNCTION notify_referral_event(
  p_recipient_user_id uuid,
  p_template           text,
  p_dedupe_key         text,
  p_metadata           jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notification_outbox (user_ref, hub_user_id, template, category, deep_link, dedupe_key, metadata)
  VALUES (p_recipient_user_id::text, p_recipient_user_id, p_template, 'rewards', '/referrals', p_dedupe_key, p_metadata)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION notify_referral_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_referral_event(uuid, text, text, jsonb) TO service_role;

-- ── enqueue_web_push_job (047): extend the push-eligible whitelist to the
--    5 referral templates and the 'rewards' category — everything else in
--    that function is unchanged. rewards_enabled already defaults to false
--    (hub_notification_preferences, 047), so referral push stays opt-in,
--    same posture the schema already intended for this category. ─────────

CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND NEW.category IN ('orders', 'refunds', 'vouchers', 'rewards')
     AND NEW.template IN (
       'order_placed', 'order_accepted', 'order_dispatched',
       'order_delivered', 'digital_delivered', 'order_cancelled',
       'refund_initiated', 'refund_completed', 'refund_failed',
       'voucher_ready', 'voucher_failed', 'voucher_reconciliation',
       'referral_signup_held', 'referral_signup_released',
       'referral_activation_held', 'referral_activation_released',
       'referral_manual_review'
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id)
    VALUES (NEW.id, NEW.hub_user_id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

-- ── create_or_get_hub_pass_with_referral (053): notify on 'bound' —
--    "A friend joined with your invite. 50 Miles are pending." ──────────

CREATE OR REPLACE FUNCTION create_or_get_hub_pass_with_referral(
  p_user_id              uuid,
  p_email                text,
  p_src                  text DEFAULT 'organic',
  p_referral_token_hash  text DEFAULT NULL
) RETURNS TABLE(public_pass_id uuid, is_new boolean, referral_outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing        uuid;
  v_inserted        uuid;
  v_pass_created_at timestamptz;
  v_outcome         text := 'none';
  v_click           referral_clicks%ROWTYPE;
  v_program         referral_program_versions%ROWTYPE;
  v_code            hub_referral_codes%ROWTYPE;
  v_referrer_id     uuid;
  v_referral_id     uuid;
  v_total_reserve   integer;
  v_signup_key      text;
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
            UPDATE referral_program_versions
            SET reserved_budget_miles = reserved_budget_miles + v_total_reserve
            WHERE id = v_program.id;

            INSERT INTO hub_referrals (
              program_version_id, referral_code_id, referral_click_id,
              referrer_user_id, referred_user_id, referred_pass_id,
              status, signup_reward_miles, activation_reward_miles, min_purchase_kes,
              activation_expires_at
            ) VALUES (
              v_program.id, v_code.id, v_click.id,
              v_referrer_id, p_user_id, v_inserted,
              'pass_activated', v_program.signup_reward_miles, v_program.activation_reward_miles,
              v_program.min_purchase_kes,
              v_pass_created_at + make_interval(days => v_program.activation_window_days)
            )
            RETURNING id INTO v_referral_id;

            v_signup_key := 'hub-referral:' || v_program.version::text || ':' || v_referral_id::text || ':signup:referrer';

            INSERT INTO referral_reward_jobs (
              referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at
            ) VALUES (
              v_referral_id, 'signup', v_referrer_id, v_program.signup_reward_miles, v_signup_key,
              now() + make_interval(hours => v_program.signup_hold_hours)
            );

            UPDATE referral_clicks SET status = 'bound', bound_at = now() WHERE id = v_click.id;

            INSERT INTO referral_events (referral_id, referral_click_id, actor_type, event_type, to_state, metadata)
            VALUES (
              v_referral_id, v_click.id, 'system', 'referral_bound', 'pass_activated',
              jsonb_build_object('referrerUserId', v_referrer_id, 'programVersionId', v_program.id)
            );
            INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
            VALUES (v_referral_id, 'system', 'referral_signup_reward_held', 'pending_hold');

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

-- ── qualify_referral_activation (053): notify when the activation job is
--    created — "Your friend became active. 100 Miles are pending." ──────

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

  BEGIN
    UPDATE hub_referrals
    SET status = 'qualified',
        qualification_type = p_qualification_type,
        qualification_reference = p_qualification_reference,
        qualified_at = now(),
        updated_at = now()
    WHERE id = v_referral.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'duplicate_proof'::text; RETURN;
  END;

  v_activation_key := 'hub-referral:' || v_program.version::text || ':' || v_referral.id::text || ':activation:referrer';

  INSERT INTO referral_reward_jobs (
    referral_id, milestone, recipient_user_id, amount_miles, idempotency_key, eligible_at
  ) VALUES (
    v_referral.id, 'activation', v_referral.referrer_user_id, v_referral.activation_reward_miles, v_activation_key,
    now() + make_interval(hours => v_program.activation_hold_hours)
  )
  ON CONFLICT (referral_id, milestone) DO NOTHING;

  INSERT INTO referral_events (referral_id, actor_type, event_type, from_state, to_state, metadata)
  VALUES (
    v_referral.id, 'system', 'referral_qualified', 'pass_activated', 'qualified',
    jsonb_build_object(
      'qualificationType', p_qualification_type,
      'qualificationReference', p_qualification_reference,
      'grossAmountKes', p_gross_amount_kes
    )
  );
  INSERT INTO referral_events (referral_id, actor_type, event_type, to_state)
  VALUES (v_referral.id, 'system', 'referral_activation_reward_held', 'pending_hold');

  PERFORM notify_referral_event(
    v_referral.referrer_user_id, 'referral_activation_held',
    'notif:referral:' || v_referral.id::text || ':activation:held',
    jsonb_build_object('referralId', v_referral.id)
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

-- ── complete_referral_reward_job (056): notify on release —
--    "You earned 50 Miles for a referral." /
--    "You earned another 100 Miles. Referral complete!" — and on the
--    max-attempts manual_review transition — "A referral reward needs more
--    time for review." ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION complete_referral_reward_job(
  p_job_id             uuid,
  p_worker_id          text,
  p_ok                 boolean,
  p_retryable          boolean,
  p_platform_reference text DEFAULT NULL,
  p_error_code         text DEFAULT NULL,
  p_error_detail       text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job            referral_reward_jobs%ROWTYPE;
  v_referral       hub_referrals%ROWTYPE;
  v_max_attempts   constant integer := 10;
  v_detail         text := left(coalesce(p_error_detail, ''), 500);
  v_both_released  boolean;
BEGIN
  SELECT * INTO v_job FROM referral_reward_jobs
  WHERE id = p_job_id AND lease_owner = p_worker_id AND status = 'processing'
    AND lease_expires_at > now() AND released_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_ok THEN
    UPDATE referral_reward_jobs
    SET status = 'released', released_at = now(), platform_reference = p_platform_reference,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = NULL, last_error_detail = NULL, updated_at = now()
    WHERE id = p_job_id;

    SELECT * INTO v_referral FROM hub_referrals WHERE id = v_job.referral_id FOR UPDATE;

    UPDATE referral_program_versions
    SET reserved_budget_miles = reserved_budget_miles - v_job.amount_miles,
        released_budget_miles = released_budget_miles + v_job.amount_miles
    WHERE id = v_referral.program_version_id;

    SELECT NOT EXISTS (
      SELECT 1 FROM referral_reward_jobs WHERE referral_id = v_referral.id AND status <> 'released'
    ) INTO v_both_released;

    UPDATE hub_referrals
    SET status = CASE WHEN v_both_released THEN 'complete' ELSE status END, updated_at = now()
    WHERE id = v_referral.id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, to_state, metadata)
    VALUES (
      v_referral.id, 'worker',
      CASE WHEN v_job.milestone = 'signup' THEN 'referral_signup_reward_released' ELSE 'referral_activation_reward_released' END,
      CASE WHEN v_both_released THEN 'complete' ELSE v_referral.status END,
      jsonb_build_object('jobId', v_job.id, 'amountMiles', v_job.amount_miles, 'platformReference', p_platform_reference)
    );

    PERFORM notify_referral_event(
      v_job.recipient_user_id,
      CASE WHEN v_job.milestone = 'signup' THEN 'referral_signup_released' ELSE 'referral_activation_released' END,
      'notif:referral:' || v_job.referral_id::text || ':' || v_job.milestone || ':released',
      jsonb_build_object('jobId', v_job.id, 'amountMiles', v_job.amount_miles)
    );

    RETURN true;
  END IF;

  IF p_retryable AND v_job.attempts < v_max_attempts THEN
    UPDATE referral_reward_jobs
    SET status = 'eligible',
        next_retry_at = now() + (LEAST(v_job.attempts, 6) * interval '5 minutes') + (random() * interval '30 seconds'),
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE referral_reward_jobs
    SET status = 'manual_review',
        last_error_code = p_error_code, last_error_detail = v_detail,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_job_id;

    INSERT INTO referral_events (referral_id, actor_type, event_type, reason_code, metadata)
    VALUES (
      v_job.referral_id, 'worker', 'referral_manual_reviewed', p_error_code,
      jsonb_build_object('jobId', v_job.id, 'reason', 'max_attempts_exceeded')
    );

    PERFORM notify_referral_event(
      v_job.recipient_user_id, 'referral_manual_review',
      'notif:referral:' || v_job.referral_id::text || ':' || v_job.milestone || ':manual_review',
      jsonb_build_object('jobId', v_job.id)
    );
  END IF;

  RETURN true;
END;
$$;

-- ── claim_referral_reward_jobs (056): notify each job routed to
--    manual_review by the blacklist check. Bulk case — a CTE instead of a
--    per-row PERFORM loop, same notify_referral_event shape inlined. ─────

CREATE OR REPLACE FUNCTION claim_referral_reward_jobs(
  p_limit          integer,
  p_worker_id      text,
  p_lease_seconds  integer
) RETURNS SETOF referral_reward_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT referral_flag_enabled('release_rewards') THEN
    RETURN;
  END IF;

  WITH routed AS (
    UPDATE referral_reward_jobs j
    SET status = 'manual_review', updated_at = now()
    WHERE j.status IN ('pending_hold', 'eligible')
      AND j.eligible_at <= now()
      AND EXISTS (
        SELECT 1 FROM hub_user_risk_flags f
        WHERE f.hub_user_id = j.recipient_user_id AND f.is_active
          AND f.flag_type IN ('blacklisted', 'rewards_disabled')
      )
    RETURNING j.id, j.referral_id, j.recipient_user_id, j.milestone
  )
  INSERT INTO notification_outbox (user_ref, hub_user_id, template, category, deep_link, dedupe_key, metadata)
  SELECT
    routed.recipient_user_id::text, routed.recipient_user_id, 'referral_manual_review', 'rewards', '/referrals',
    'notif:referral:' || routed.referral_id::text || ':' || routed.milestone || ':manual_review',
    jsonb_build_object('jobId', routed.id)
  FROM routed
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN QUERY
  UPDATE referral_reward_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id IN (
    SELECT id FROM referral_reward_jobs
    WHERE (
      (status IN ('pending_hold', 'eligible') AND eligible_at <= now()
        AND (next_retry_at IS NULL OR next_retry_at <= now()))
      OR (status = 'processing' AND released_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
    )
    ORDER BY eligible_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

NOTIFY pgrst, 'reload schema';
