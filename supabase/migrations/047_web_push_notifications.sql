-- 047_web_push_notifications.sql
-- Hub Web Push Notifications (W3C Web Push + VAPID) for orders, refunds,
-- and vouchers. See packages/hub-page/docs/web-push-notifications-spec.md.
--
-- notification_outbox remains the canonical user-visible event; this
-- migration adds web_push_jobs/web_push_deliveries so push delivery state
-- is never conflated with "in-app row is visible".

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Subscriptions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id     uuid NOT NULL,
  endpoint            text NOT NULL,
  endpoint_hash       text NOT NULL UNIQUE,
  p256dh              text NOT NULL,
  auth_secret         text NOT NULL,
  platform            text NOT NULL
                        CHECK (platform IN ('ios', 'android', 'desktop', 'unknown')),
  user_agent          text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired')),
  failure_count       integer NOT NULL DEFAULT 0,
  last_success_at     timestamptz,
  last_failure_at     timestamptz,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_active
  ON web_push_subscriptions(hub_user_id)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_wps_touch_updated_at ON web_push_subscriptions;
CREATE TRIGGER trg_wps_touch_updated_at
  BEFORE UPDATE ON web_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ── Preferences ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_notification_preferences (
  hub_user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  orders_enabled    boolean NOT NULL DEFAULT true,
  vouchers_enabled  boolean NOT NULL DEFAULT true,
  rewards_enabled   boolean NOT NULL DEFAULT false,
  marketing_enabled boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_hnp_touch_updated_at ON hub_notification_preferences;
CREATE TRIGGER trg_hnp_touch_updated_at
  BEFORE UPDATE ON hub_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ── notification_outbox additions ─────────────────────────────────────────
ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS hub_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS deep_link text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'notification_outbox'::regclass
      AND conname = 'chk_notification_outbox_category'
  ) THEN
    ALTER TABLE notification_outbox
      ADD CONSTRAINT chk_notification_outbox_category
      CHECK (category IS NULL OR category IN ('orders', 'refunds', 'vouchers', 'rewards', 'marketing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'notification_outbox'::regclass
      AND conname = 'chk_notification_outbox_deep_link'
  ) THEN
    ALTER TABLE notification_outbox
      ADD CONSTRAINT chk_notification_outbox_deep_link
      CHECK (deep_link IS NULL OR (deep_link LIKE '/%' AND deep_link NOT LIKE '//%'));
  END IF;
END
$$;

-- ── Recipient/category/deep-link resolution (legacy producers) ───────────
-- New producers (voucher notifications below) already know hub_user_id and
-- set category/deep_link explicitly; this only fills gaps left by existing
-- order/refund producers that only have user_ref. Zero matches leaves
-- hub_user_id null (row stays visible in-app, no push). More than one match
-- is a reconciliation error and must not enqueue a push.
CREATE OR REPLACE FUNCTION resolve_notification_recipient()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uuid_candidate uuid;
  v_match_count    integer;
  v_matched_user   uuid;
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := CASE
      WHEN NEW.template IN (
        'order_placed', 'order_accepted', 'order_dispatched',
        'order_delivered', 'digital_delivered', 'order_cancelled'
      ) THEN 'orders'
      WHEN NEW.template IN ('refund_initiated', 'refund_completed', 'refund_failed') THEN 'refunds'
      WHEN NEW.template IN ('voucher_ready', 'voucher_failed', 'voucher_reconciliation') THEN 'vouchers'
      ELSE NULL
    END;
  END IF;

  IF NEW.deep_link IS NULL AND NEW.category IN ('orders', 'refunds') THEN
    NEW.deep_link := '/me/orders';
  END IF;

  IF NEW.hub_user_id IS NULL AND NEW.user_ref IS NOT NULL THEN
    BEGIN
      v_uuid_candidate := NEW.user_ref::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_uuid_candidate := NULL;
    END;

    IF v_uuid_candidate IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.users WHERE id = v_uuid_candidate
    ) THEN
      NEW.hub_user_id := v_uuid_candidate;
    END IF;

    IF NEW.hub_user_id IS NULL THEN
      SELECT COUNT(DISTINCT id), MIN(id) INTO v_match_count, v_matched_user
      FROM auth.users
      WHERE lower(email) = lower(trim(NEW.user_ref));

      IF v_match_count = 1 THEN
        NEW.hub_user_id := v_matched_user;
      END IF;
    END IF;

    IF NEW.hub_user_id IS NULL THEN
      SELECT COUNT(DISTINCT user_id), MIN(user_id) INTO v_match_count, v_matched_user
      FROM hub_user_wallets
      WHERE lower(address) = lower(trim(NEW.user_ref));

      IF v_match_count = 1 THEN
        NEW.hub_user_id := v_matched_user;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notification_outbox_resolve_recipient ON notification_outbox;
CREATE TRIGGER trg_notification_outbox_resolve_recipient
  BEFORE INSERT ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION resolve_notification_recipient();

-- ── Push jobs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_push_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id       uuid NOT NULL UNIQUE REFERENCES notification_outbox(id),
  hub_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'processing', 'retry',
                            'completed', 'suppressed', 'dead'
                          )),
  attempts              integer NOT NULL DEFAULT 0,
  available_at          timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at          timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_jobs_claim
  ON web_push_jobs(status, available_at, created_at);

DROP TRIGGER IF EXISTS trg_wpj_touch_updated_at ON web_push_jobs;
CREATE TRIGGER trg_wpj_touch_updated_at
  BEFORE UPDATE ON web_push_jobs
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- Push-eligible templates in Phase 1 (transactional only).
CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND NEW.category IN ('orders', 'refunds', 'vouchers')
     AND NEW.template IN (
       'order_placed', 'order_accepted', 'order_dispatched',
       'order_delivered', 'digital_delivered', 'order_cancelled',
       'refund_initiated', 'refund_completed', 'refund_failed',
       'voucher_ready', 'voucher_failed', 'voucher_reconciliation'
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id)
    VALUES (NEW.id, NEW.hub_user_id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notification_outbox_enqueue_push ON notification_outbox;
CREATE TRIGGER trg_notification_outbox_enqueue_push
  AFTER INSERT ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION enqueue_web_push_job();

-- ── Delivery attempts (one per job x subscription) ───────────────────────
CREATE TABLE IF NOT EXISTS web_push_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES web_push_jobs(id) ON DELETE CASCADE,
  subscription_id  uuid NOT NULL REFERENCES web_push_subscriptions(id),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'retry', 'gone', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  provider_status  integer,
  last_error       text,
  accepted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, subscription_id)
);

DROP TRIGGER IF EXISTS trg_wpd_touch_updated_at ON web_push_deliveries;
CREATE TRIGGER trg_wpd_touch_updated_at
  BEFORE UPDATE ON web_push_deliveries
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ── Claim / complete RPCs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_web_push_jobs(p_limit integer, p_worker_id text)
RETURNS TABLE(
  job_id          uuid,
  notification_id uuid,
  hub_user_id     uuid,
  template        text,
  category        text,
  deep_link       text,
  metadata        jsonb,
  attempts        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Re-arm stale processing jobs (a worker died mid-batch).
  UPDATE web_push_jobs
  SET status = 'pending', processing_started_at = NULL
  WHERE status = 'processing'
    AND processing_started_at < now() - interval '10 minutes';

  RETURN QUERY
  UPDATE web_push_jobs j
  SET status = 'processing',
      attempts = j.attempts + 1,
      processing_started_at = now()
  FROM (
    SELECT id
    FROM web_push_jobs
    WHERE status IN ('pending', 'retry')
      AND available_at <= now()
    ORDER BY created_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  ) claimable
  WHERE j.id = claimable.id
  RETURNING
    j.id,
    j.notification_id,
    j.hub_user_id,
    (SELECT n.template FROM notification_outbox n WHERE n.id = j.notification_id),
    (SELECT n.category FROM notification_outbox n WHERE n.id = j.notification_id),
    (SELECT n.deep_link FROM notification_outbox n WHERE n.id = j.notification_id),
    (SELECT n.metadata FROM notification_outbox n WHERE n.id = j.notification_id),
    j.attempts;
END
$$;

-- Retry backoff schedule (seconds), indexed by attempt number (1-based).
CREATE OR REPLACE FUNCTION web_push_retry_delay_seconds(p_attempts integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (ARRAY[60, 120, 300, 900, 1800, 3600, 10800, 21600])[LEAST(GREATEST(p_attempts, 1), 8)];
$$;

CREATE OR REPLACE FUNCTION complete_web_push_job(
  p_job_id       uuid,
  p_outcome      text, -- 'accepted' | 'suppressed' | 'no_active_subscriptions' | 'retry' | 'config_error'
  p_error        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job web_push_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM web_push_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Never overwrite a terminal outcome on a late/duplicate retry report.
  IF v_job.status IN ('completed', 'suppressed', 'dead') THEN
    RETURN;
  END IF;

  IF p_outcome IN ('accepted', 'no_active_subscriptions') THEN
    UPDATE web_push_jobs
    SET status = 'completed', completed_at = now(), last_error = NULL
    WHERE id = p_job_id;
  ELSIF p_outcome = 'suppressed' THEN
    UPDATE web_push_jobs
    SET status = 'suppressed', completed_at = now(), last_error = p_error
    WHERE id = p_job_id;
  ELSIF p_outcome = 'config_error' THEN
    -- Global VAPID/config failure: re-arm shortly, don't burn attempts toward dead.
    UPDATE web_push_jobs
    SET status = 'retry',
        available_at = now() + interval '2 minutes',
        last_error = left(COALESCE(p_error, 'config_error'), 2000)
    WHERE id = p_job_id;
  ELSE -- 'retry'
    IF v_job.attempts >= 8 THEN
      UPDATE web_push_jobs
      SET status = 'dead', completed_at = now(), last_error = left(COALESCE(p_error, 'retries exhausted'), 2000)
      WHERE id = p_job_id;
    ELSE
      UPDATE web_push_jobs
      SET status = 'retry',
          available_at = now() + make_interval(secs => web_push_retry_delay_seconds(v_job.attempts)),
          last_error = left(COALESCE(p_error, 'retry'), 2000)
      WHERE id = p_job_id;
    END IF;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION claim_web_push_jobs(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_web_push_job(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_web_push_jobs(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION complete_web_push_job(uuid, text, text) TO service_role;

-- ── Subscription rate limiting (fixed 10-minute buckets) ──────────────────
CREATE TABLE IF NOT EXISTS web_push_subscription_rate_limit (
  scope        text NOT NULL, -- 'user:<uuid>' or 'ip:<address>'
  bucket_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_start)
);

CREATE OR REPLACE FUNCTION check_push_subscription_rate_limit(
  p_hub_user_id uuid,
  p_ip          text,
  p_user_limit  integer DEFAULT 20,
  p_ip_limit    integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket      timestamptz := date_trunc('hour', now()) + (floor(date_part('minute', now()) / 10) * interval '10 minutes');
  v_user_count  integer;
  v_ip_count    integer;
BEGIN
  DELETE FROM web_push_subscription_rate_limit WHERE bucket_start < now() - interval '1 hour';

  INSERT INTO web_push_subscription_rate_limit(scope, bucket_start, count)
  VALUES ('user:' || p_hub_user_id::text, v_bucket, 1)
  ON CONFLICT (scope, bucket_start) DO UPDATE SET count = web_push_subscription_rate_limit.count + 1
  RETURNING count INTO v_user_count;

  IF p_ip IS NOT NULL THEN
    INSERT INTO web_push_subscription_rate_limit(scope, bucket_start, count)
    VALUES ('ip:' || p_ip, v_bucket, 1)
    ON CONFLICT (scope, bucket_start) DO UPDATE SET count = web_push_subscription_rate_limit.count + 1
    RETURNING count INTO v_ip_count;
  ELSE
    v_ip_count := 0;
  END IF;

  RETURN v_user_count <= p_user_limit AND v_ip_count <= p_ip_limit;
END
$$;

REVOKE ALL ON FUNCTION check_push_subscription_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_push_subscription_rate_limit(uuid, text, integer, integer) TO service_role;

-- ── Grants on new tables ───────────────────────────────────────────────────
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscription_rate_limit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON web_push_subscriptions, hub_notification_preferences, web_push_jobs,
  web_push_deliveries, web_push_subscription_rate_limit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON web_push_subscriptions, hub_notification_preferences,
  web_push_jobs, web_push_deliveries, web_push_subscription_rate_limit
  TO service_role;

-- ── Voucher notification producers ────────────────────────────────────────
-- reserve_voucher_purchase: add a voucher_ready notification to the
-- ledger-only synchronous finalization branch. Full function body reproduced
-- from 046_hub_miles_spend_intents.sql with this one addition.
CREATE OR REPLACE FUNCTION reserve_voucher_purchase(
  p_hub_user_id        uuid,
  p_email              text,
  p_wallets            text[],
  p_wallet_address     text,
  p_template_id        uuid,
  p_merchant_id        uuid,
  p_code               text,
  p_total_points       integer,
  p_idempotency_key    text,
  p_consent_method     text,
  p_disclosure_version text,
  p_quote_id           uuid,
  p_onchain_balance_ok boolean,
  p_onchain_balance    numeric
)
RETURNS TABLE(
  intent_id      uuid,
  voucher_id     uuid,
  code           text,
  ledger_points  integer,
  onchain_points integer,
  state          text,
  failure_code   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing          record;
  v_quote             voucher_purchase_quotes%ROWTYPE;
  v_request_hash      text;
  v_canonical_ids     uuid[];
  v_cid               uuid;
  v_available         integer;
  v_ledger_points     integer;
  v_onchain_points    integer;
  v_remaining         integer;
  v_allocation        integer;
  v_reserved          record;
  v_voucher_id        uuid;
  v_intent_id         uuid;
  v_burn_job_id       uuid;
  v_miles_cost        integer;
  v_cooldown_seconds  integer;
  v_wallet            text := NULLIF(lower(trim(p_wallet_address)), '');
BEGIN
  IF p_total_points IS NULL OR p_total_points <= 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS' USING ERRCODE = 'P0001';
  END IF;

  v_request_hash := encode(digest(
    concat_ws(':',
      p_hub_user_id::text,
      p_template_id::text,
      p_merchant_id::text,
      p_total_points::text,
      COALESCE(v_wallet, ''),
      COALESCE(p_quote_id::text, ''),
      p_consent_method,
      p_disclosure_version
    ),
    'sha256'
  ), 'hex');

  -- Serialize both concurrent first attempts and later replays of this key.
  PERFORM pg_advisory_xact_lock(hashtext('voucher-purchase:' || p_idempotency_key));

  SELECT msi.*, iv.code AS stored_code
  INTO v_existing
  FROM miles_spend_intents msi
  JOIN issued_vouchers iv ON iv.id = msi.voucher_id
  WHERE msi.idempotency_key = p_idempotency_key
  FOR UPDATE OF msi;

  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT v_existing.id, v_existing.voucher_id, v_existing.stored_code,
           v_existing.ledger_points, v_existing.onchain_points,
           v_existing.state, v_existing.failure_code;
    RETURN;
  END IF;

  IF p_quote_id IS NOT NULL THEN
    SELECT * INTO v_quote
    FROM voucher_purchase_quotes
    WHERE id = p_quote_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_quote.expires_at <= now()
       OR v_quote.hub_user_id <> p_hub_user_id
       OR v_quote.template_id <> p_template_id
       OR v_quote.merchant_id <> p_merchant_id
       OR v_quote.total_points <> p_total_points
       OR v_quote.purchase_key <> p_idempotency_key
       OR v_quote.disclosure_version <> p_disclosure_version
       OR v_quote.wallet_address IS DISTINCT FROM v_wallet THEN
      RAISE EXCEPTION 'QUOTE_STALE' USING ERRCODE = 'P0001';
    END IF;

    IF v_quote.consumed THEN
      -- A consumed quote without an intent means prior work did not commit.
      RAISE EXCEPTION 'QUOTE_STALE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_canonical_ids := resolve_canonical_ids(p_email, p_wallets);
  FOREACH v_cid IN ARRAY v_canonical_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_cid::text));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext('hub-user:' || p_hub_user_id::text));
  IF v_wallet IS NOT NULL THEN
    -- Same key used by reserve_miles_burn and legacy on-chain spenders.
    PERFORM pg_advisory_xact_lock(hashtext(v_wallet));
  END IF;

  v_available := GREATEST(available_ledger_points(v_canonical_ids), 0);

  IF p_quote_id IS NOT NULL THEN
    IF v_quote.ledger_points > v_available THEN
      RAISE EXCEPTION 'QUOTE_STALE' USING ERRCODE = 'P0001';
    END IF;
    v_ledger_points := v_quote.ledger_points;
    v_onchain_points := v_quote.onchain_points;
  ELSE
    v_ledger_points := LEAST(p_total_points, v_available);
    v_onchain_points := p_total_points - v_ledger_points;
  END IF;

  IF v_onchain_points > 0 THEN
    IF v_wallet IS NULL THEN
      RAISE EXCEPTION 'WALLET_REQUIRED_FOR_ONCHAIN_PORTION' USING ERRCODE = 'P0001';
    END IF;
    IF NOT p_onchain_balance_ok THEN
      RAISE EXCEPTION 'BALANCE_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- New Hub purchases cool down by Hub identity, not by whichever wallet is
  -- currently selected. The legacy address check still runs downstream.
  SELECT cooldown_seconds INTO v_cooldown_seconds
  FROM spend_voucher_templates
  WHERE id = p_template_id;

  IF COALESCE(v_cooldown_seconds, 0) > 0
     AND EXISTS (
       SELECT 1
       FROM issued_vouchers
       WHERE hub_user_id = p_hub_user_id
         AND voucher_template_id = p_template_id
         AND status NOT IN ('void','expired')
         AND created_at > now() - make_interval(secs => v_cooldown_seconds)
     ) THEN
    RAISE EXCEPTION 'COOLDOWN_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.voucher_id, r.code, r.status, r.miles_cost
  INTO v_reserved
  FROM reserve_with_program_atomic_hub(
    p_template_id,
    v_wallet,
    p_merchant_id,
    p_code,
    p_idempotency_key || ':voucher',
    p_hub_user_id
  ) r;

  v_voucher_id := v_reserved.voucher_id;
  v_miles_cost := v_reserved.miles_cost;

  IF v_miles_cost <> p_total_points THEN
    RAISE EXCEPTION 'PRICE_MISMATCH: expected %, template now costs %',
      p_total_points, v_miles_cost USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO miles_spend_intents(
    idempotency_key, request_hash, hub_user_id, wallet_address, voucher_id,
    template_id, merchant_id, total_points, ledger_points, onchain_points,
    consent_method, disclosure_version, quote_id, state
  )
  VALUES (
    p_idempotency_key, v_request_hash, p_hub_user_id, v_wallet, v_voucher_id,
    p_template_id, p_merchant_id, p_total_points, v_ledger_points, v_onchain_points,
    p_consent_method, p_disclosure_version, p_quote_id, 'reserved'
  )
  RETURNING id INTO v_intent_id;

  -- Allocate the ledger portion without posting a debit yet.
  v_remaining := v_ledger_points;
  FOREACH v_cid IN ARRAY v_canonical_ids LOOP
    EXIT WHEN v_remaining <= 0;
    v_available := GREATEST(available_ledger_points(ARRAY[v_cid]), 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    v_allocation := LEAST(v_remaining, v_available);
    INSERT INTO miles_ledger_holds(
      canonical_id, hub_user_id, intent_id, points, status
    )
    VALUES (v_cid, p_hub_user_id, v_intent_id, v_allocation, 'active');
    v_remaining := v_remaining - v_allocation;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: ledger availability changed'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_onchain_points > 0 THEN
    IF NOT p_onchain_balance_ok THEN
      RAISE EXCEPTION 'BALANCE_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    SELECT rb.job_id INTO v_burn_job_id
    FROM reserve_miles_burn(
      v_wallet,
      v_onchain_points,
      p_onchain_balance,
      p_idempotency_key || ':burn',
      'hub_voucher_purchase',
      jsonb_build_object(
        'kind', 'hub_voucher_issue',
        'voucher_id', v_voucher_id,
        'intent_id', v_intent_id
      )
    ) rb;

    UPDATE miles_spend_intents
    SET burn_job_id = v_burn_job_id
    WHERE id = v_intent_id;
  ELSE
    -- Ledger-only: settle and issue inside this reservation transaction.
    INSERT INTO miles_ledger(
      canonical_id, amount, direction, source_type, source_id,
      partner_id, on_chain, note
    )
    SELECT canonical_id, points, 'debit', 'purchase', v_voucher_id,
           p_merchant_id, false, 'hub_voucher_purchase'
    FROM miles_ledger_holds mlh
    WHERE mlh.intent_id = v_intent_id AND mlh.status = 'active';

    UPDATE miles_ledger_holds mlh
    SET status = 'consumed'
    WHERE mlh.intent_id = v_intent_id AND mlh.status = 'active';

    UPDATE issued_vouchers
    SET status = 'issued'
    WHERE id = v_voucher_id AND status = 'pending';

    UPDATE miles_spend_intents
    SET state = 'finalized', confirmed_at = now()
    WHERE id = v_intent_id;

    IF NOT EXISTS (
      SELECT 1 FROM voucher_events
      WHERE issued_voucher_id = v_voucher_id AND event_type = 'issued'
    ) THEN
      INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
      VALUES (
        v_voucher_id, 'issued', p_hub_user_id::text,
        jsonb_build_object('intent_id', v_intent_id, 'funding', 'ledger')
      );
    END IF;

    INSERT INTO notification_outbox(
      hub_user_id, user_ref, template, category, deep_link, dedupe_key, metadata
    )
    VALUES (
      p_hub_user_id, p_hub_user_id::text, 'voucher_ready', 'vouchers',
      '/vouchers/' || v_voucher_id::text,
      'notif:voucher:' || v_voucher_id::text || ':voucher_ready',
      jsonb_build_object('voucher_id', v_voucher_id)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  IF p_quote_id IS NOT NULL THEN
    UPDATE voucher_purchase_quotes SET consumed = true WHERE id = p_quote_id;
  END IF;

  RETURN QUERY
  SELECT msi.id, msi.voucher_id, iv.code, msi.ledger_points,
         msi.onchain_points, msi.state, msi.failure_code
  FROM miles_spend_intents msi
  JOIN issued_vouchers iv ON iv.id = msi.voucher_id
  WHERE msi.id = v_intent_id;
END
$$;

REVOKE ALL ON FUNCTION reserve_voucher_purchase(
  uuid,text,text[],text,uuid,uuid,text,integer,text,text,text,uuid,boolean,numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_voucher_purchase(
  uuid,text,text[],text,uuid,uuid,text,integer,text,text,text,uuid,boolean,numeric
) TO service_role;

-- finalize_hub_voucher_burn: add a voucher_ready notification on-chain
-- confirmation (main path only -- the early "already finalized" return is a
-- pure idempotent replay of a completed job and already got its
-- notification the first time).
CREATE OR REPLACE FUNCTION finalize_hub_voucher_burn(
  p_job_id uuid,
  p_intent_id uuid,
  p_voucher_id uuid,
  p_tx_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent miles_spend_intents%ROWTYPE;
  v_job minipoint_burn_jobs%ROWTYPE;
  v_voucher issued_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_intent FROM miles_spend_intents WHERE id = p_intent_id FOR UPDATE;
  SELECT * INTO v_job FROM minipoint_burn_jobs WHERE id = p_job_id FOR UPDATE;
  SELECT * INTO v_voucher FROM issued_vouchers WHERE id = p_voucher_id FOR UPDATE;

  IF v_intent.id IS NULL OR v_job.id IS NULL OR v_voucher.id IS NULL
     OR v_intent.voucher_id <> p_voucher_id
     OR v_intent.burn_job_id <> p_job_id
     OR v_job.payload->>'intent_id' <> p_intent_id::text
     OR v_job.payload->>'voucher_id' <> p_voucher_id::text
     OR v_job.tx_hash IS DISTINCT FROM p_tx_hash
     OR v_intent.submitted_tx_hash IS DISTINCT FROM p_tx_hash THEN
    RAISE EXCEPTION 'BURN_INTENT_ASSOCIATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_intent.state = 'finalized' THEN
    UPDATE minipoint_burn_jobs
    SET status = 'completed', last_error = NULL,
        processing_by = NULL, processing_started_at = NULL
    WHERE id = p_job_id;
    RETURN;
  END IF;

  IF v_intent.state NOT IN (
    'onchain_prepared','onchain_submitted','reconciliation_required'
  ) OR v_voucher.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_FINALIZATION_STATE: intent=%, voucher=%',
      v_intent.state, v_voucher.status USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO miles_ledger(
    canonical_id, amount, direction, source_type, source_id,
    partner_id, on_chain, note
  )
  SELECT canonical_id, points, 'debit', 'purchase', p_voucher_id,
         v_intent.merchant_id, false, 'hub_voucher_purchase'
  FROM miles_ledger_holds
  WHERE intent_id = p_intent_id AND status = 'active';

  UPDATE miles_ledger_holds
  SET status = 'consumed'
  WHERE intent_id = p_intent_id AND status = 'active';

  UPDATE issued_vouchers
  SET status = 'issued', burn_tx_hash = p_tx_hash, recovery_state = NULL
  WHERE id = p_voucher_id;

  UPDATE miles_spend_intents
  SET state = 'finalized',
      confirmed_at = now(),
      failure_code = NULL,
      failure_reason = NULL
  WHERE id = p_intent_id;

  UPDATE minipoint_burn_jobs
  SET status = 'completed',
      tx_hash = p_tx_hash,
      last_error = NULL,
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id;

  IF NOT EXISTS (
    SELECT 1 FROM voucher_events
    WHERE issued_voucher_id = p_voucher_id
      AND event_type = 'burn_confirmed'
      AND metadata->>'intent_id' = p_intent_id::text
  ) THEN
    INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'burn_confirmed', 'burn_worker',
      jsonb_build_object('tx_hash', p_tx_hash, 'intent_id', p_intent_id)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM voucher_events
    WHERE issued_voucher_id = p_voucher_id
      AND event_type = 'issued'
      AND metadata->>'intent_id' = p_intent_id::text
  ) THEN
    INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'issued', 'burn_worker',
      jsonb_build_object('intent_id', p_intent_id, 'funding', 'split_or_onchain')
    );
  END IF;

  INSERT INTO notification_outbox(
    hub_user_id, user_ref, template, category, deep_link, dedupe_key, metadata
  )
  VALUES (
    v_intent.hub_user_id, v_intent.hub_user_id::text, 'voucher_ready', 'vouchers',
    '/vouchers/' || p_voucher_id::text,
    'notif:voucher:' || p_voucher_id::text || ':voucher_ready',
    jsonb_build_object('voucher_id', p_voucher_id, 'intent_id', p_intent_id)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;

-- fail_hub_voucher_burn: add a voucher_failed notification. Reachable from
-- both the already-failed early return (still safe: dedupe_key is unique so
-- a duplicate insert is a harmless no-op) and the main failure path.
CREATE OR REPLACE FUNCTION fail_hub_voucher_burn(
  p_job_id uuid,
  p_intent_id uuid,
  p_voucher_id uuid,
  p_failure_code text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent miles_spend_intents%ROWTYPE;
  v_job minipoint_burn_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_intent FROM miles_spend_intents WHERE id = p_intent_id FOR UPDATE;
  SELECT * INTO v_job FROM minipoint_burn_jobs WHERE id = p_job_id FOR UPDATE;
  PERFORM 1 FROM issued_vouchers WHERE id = p_voucher_id FOR UPDATE;

  IF v_intent.id IS NULL OR v_job.id IS NULL
     OR v_intent.voucher_id <> p_voucher_id
     OR v_intent.burn_job_id <> p_job_id THEN
    RAISE EXCEPTION 'BURN_INTENT_ASSOCIATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_intent.state = 'failed' THEN
    UPDATE minipoint_burn_jobs
    SET status = 'failed',
        last_error = left(COALESCE(p_error, 'burn_failed'), 2000),
        processing_by = NULL,
        processing_started_at = NULL
    WHERE id = p_job_id;

    INSERT INTO notification_outbox(
      hub_user_id, user_ref, template, category, deep_link, dedupe_key, metadata
    )
    VALUES (
      v_intent.hub_user_id, v_intent.hub_user_id::text, 'voucher_failed', 'vouchers',
      '/vouchers/' || p_voucher_id::text,
      'notif:voucher:' || p_voucher_id::text || ':voucher_failed',
      jsonb_build_object('voucher_id', p_voucher_id, 'intent_id', p_intent_id)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    RETURN;
  END IF;

  IF v_intent.state = 'finalized' THEN
    RAISE EXCEPTION 'FINALIZED_INTENT_CANNOT_FAIL' USING ERRCODE = 'P0001';
  END IF;

  UPDATE miles_ledger_holds
  SET status = 'released'
  WHERE intent_id = p_intent_id AND status = 'active';

  UPDATE issued_vouchers
  SET status = 'void'
  WHERE id = p_voucher_id AND status = 'pending';

  UPDATE miles_spend_intents
  SET state = 'failed',
      failed_at = now(),
      failure_code = left(COALESCE(p_failure_code, 'BURN_FAILED'), 100),
      failure_reason = left(COALESCE(p_error, 'burn failed'), 2000)
  WHERE id = p_intent_id;

  UPDATE minipoint_burn_jobs
  SET status = 'failed',
      last_error = left(COALESCE(p_error, 'burn failed'), 2000),
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id;

  IF NOT EXISTS (
    SELECT 1 FROM voucher_events
    WHERE issued_voucher_id = p_voucher_id
      AND event_type = 'voided'
      AND metadata->>'intent_id' = p_intent_id::text
  ) THEN
    INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
    VALUES (
      p_voucher_id, 'voided', 'burn_worker',
      jsonb_build_object(
        'intent_id', p_intent_id,
        'reason', p_failure_code,
        'error', p_error
      )
    );
  END IF;

  INSERT INTO notification_outbox(
    hub_user_id, user_ref, template, category, deep_link, dedupe_key, metadata
  )
  VALUES (
    v_intent.hub_user_id, v_intent.hub_user_id::text, 'voucher_failed', 'vouchers',
    '/vouchers/' || p_voucher_id::text,
    'notif:voucher:' || p_voucher_id::text || ':voucher_failed',
    jsonb_build_object('voucher_id', p_voucher_id, 'intent_id', p_intent_id)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;

-- mark_hub_voucher_reconciliation: add a voucher_reconciliation notification.
CREATE OR REPLACE FUNCTION mark_hub_voucher_reconciliation(
  p_job_id uuid,
  p_intent_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent miles_spend_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM miles_spend_intents msi
  JOIN minipoint_burn_jobs j ON j.id = msi.burn_job_id
  WHERE msi.id = p_intent_id AND j.id = p_job_id
  FOR UPDATE OF msi;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BURN_INTENT_ASSOCIATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE miles_spend_intents
  SET state = 'reconciliation_required',
      failure_code = 'BURN_OUTCOME_UNKNOWN',
      failure_reason = left(COALESCE(p_error, 'burn outcome unknown'), 2000)
  WHERE id = p_intent_id
    AND state NOT IN ('finalized','failed');

  UPDATE minipoint_burn_jobs
  SET status = 'reconciliation_required',
      last_error = left(COALESCE(p_error, 'burn outcome unknown'), 2000),
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id
    AND status <> 'completed';

  INSERT INTO notification_outbox(
    hub_user_id, user_ref, template, category, deep_link, dedupe_key, metadata
  )
  VALUES (
    v_intent.hub_user_id, v_intent.hub_user_id::text, 'voucher_reconciliation', 'vouchers',
    '/vouchers/' || v_intent.voucher_id::text,
    'notif:voucher:' || v_intent.voucher_id::text || ':voucher_reconciliation',
    jsonb_build_object('voucher_id', v_intent.voucher_id, 'intent_id', p_intent_id)
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;

REVOKE ALL ON FUNCTION finalize_hub_voucher_burn(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_hub_voucher_burn(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_hub_voucher_reconciliation(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_hub_voucher_burn(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_hub_voucher_burn(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_hub_voucher_reconciliation(uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
