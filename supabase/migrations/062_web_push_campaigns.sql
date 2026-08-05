-- 062_web_push_campaigns.sql
-- Admin-authored announcement campaigns delivered through the existing
-- notification_outbox -> web_push_jobs -> Hub push-worker pipeline.
--
-- Marketing remains opt-in: only users with marketing_enabled=true AND at
-- least one active device subscription are included in a campaign.

CREATE TABLE IF NOT EXISTS web_push_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type     text NOT NULL
                        CHECK (campaign_type IN ('feature', 'merchant', 'general')),
  title             text NOT NULL
                        CHECK (char_length(title) BETWEEN 1 AND 60),
  body              text NOT NULL
                        CHECK (char_length(body) BETWEEN 1 AND 160),
  deep_link         text NOT NULL
                        CHECK (
                          char_length(deep_link) <= 500
                          AND deep_link LIKE '/%'
                          AND deep_link NOT LIKE '//%'
                        ),
  status            text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'no_audience')),
  audience_count    integer NOT NULL DEFAULT 0 CHECK (audience_count >= 0),
  queued_count      integer NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  created_by        text,
  idempotency_key   text NOT NULL UNIQUE
                        CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS campaign_id uuid
    REFERENCES web_push_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_outbox_campaign
  ON notification_outbox(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Extend the latest enqueue allowlist (057) with the three explicitly
-- marketing-scoped templates. Unknown/custom template names remain unable to
-- reach the external push worker.
CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND (
       (
         NEW.category IN ('orders', 'refunds', 'vouchers', 'rewards')
         AND NEW.template IN (
           'order_placed', 'order_accepted', 'order_dispatched',
           'order_delivered', 'digital_delivered', 'order_cancelled',
           'refund_initiated', 'refund_completed', 'refund_failed',
           'voucher_ready', 'voucher_failed', 'voucher_reconciliation',
           'referral_signup_held', 'referral_signup_released',
           'referral_activation_held', 'referral_activation_released',
           'referral_manual_review'
         )
       )
       OR (
         NEW.category = 'marketing'
         AND NEW.template IN (
           'feature_announcement',
           'merchant_announcement',
           'general_announcement'
         )
       )
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id)
    VALUES (NEW.id, NEW.hub_user_id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

-- One row per opted-in user, with active-device count for the dashboard's
-- audience preview. No emails, endpoints, or subscription secrets are exposed.
CREATE OR REPLACE VIEW v_web_push_marketing_audience AS
SELECT
  p.hub_user_id,
  count(s.id)::integer AS active_device_count
FROM hub_notification_preferences p
JOIN web_push_subscriptions s
  ON s.hub_user_id = p.hub_user_id
 AND s.status = 'active'
WHERE p.marketing_enabled = true
GROUP BY p.hub_user_id;

CREATE OR REPLACE VIEW v_web_push_campaign_delivery_stats AS
SELECT
  c.id,
  c.campaign_type,
  c.title,
  c.body,
  c.deep_link,
  c.status,
  c.audience_count,
  c.queued_count,
  c.created_by,
  c.created_at,
  count(DISTINCT n.id) FILTER (WHERE j.status = 'completed')::integer AS processed_recipients,
  count(DISTINCT n.id) FILTER (WHERE j.status = 'dead')::integer AS dead_recipients,
  count(DISTINCT n.id) FILTER (WHERE j.status = 'suppressed')::integer AS suppressed_recipients,
  count(DISTINCT d.id) FILTER (WHERE d.status = 'accepted')::integer AS accepted_deliveries
FROM web_push_campaigns c
LEFT JOIN notification_outbox n ON n.campaign_id = c.id
LEFT JOIN web_push_jobs j ON j.notification_id = n.id
LEFT JOIN web_push_deliveries d ON d.job_id = j.id
GROUP BY c.id;

-- Atomically creates an audited campaign and its per-user notification rows.
-- The notification trigger above creates the corresponding web_push_jobs in
-- the same transaction. Retrying with the same idempotency key is a no-op.
CREATE OR REPLACE FUNCTION create_web_push_campaign(
  p_campaign_type   text,
  p_title           text,
  p_body            text,
  p_deep_link       text,
  p_created_by      text,
  p_idempotency_key text
)
RETURNS TABLE(campaign_id uuid, audience_count integer, queued_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_audience    integer;
  v_queued      integer;
  v_template    text;
BEGIN
  IF p_campaign_type IS NULL OR p_campaign_type NOT IN ('feature', 'merchant', 'general') THEN
    RAISE EXCEPTION 'INVALID_CAMPAIGN_TYPE' USING ERRCODE = 'P0001';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_body IS NULL OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'INVALID_BODY' USING ERRCODE = 'P0001';
  END IF;
  IF p_deep_link IS NULL
     OR char_length(p_deep_link) > 500
     OR p_deep_link NOT LIKE '/%'
     OR p_deep_link LIKE '//%' THEN
    RAISE EXCEPTION 'INVALID_DEEP_LINK' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO web_push_campaigns(
    campaign_type, title, body, deep_link, created_by, idempotency_key
  )
  VALUES (
    p_campaign_type, btrim(p_title), btrim(p_body), p_deep_link,
    NULLIF(btrim(p_created_by), ''), btrim(p_idempotency_key)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_campaign_id;

  IF v_campaign_id IS NULL THEN
    RETURN QUERY
    SELECT c.id, c.audience_count, c.queued_count
    FROM web_push_campaigns c
    WHERE c.idempotency_key = btrim(p_idempotency_key);
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_audience
  FROM v_web_push_marketing_audience;

  v_template := CASE p_campaign_type
    WHEN 'feature' THEN 'feature_announcement'
    WHEN 'merchant' THEN 'merchant_announcement'
    ELSE 'general_announcement'
  END;

  INSERT INTO notification_outbox(
    hub_user_id,
    user_ref,
    template,
    category,
    deep_link,
    campaign_id,
    dedupe_key,
    metadata
  )
  SELECT
    audience.hub_user_id,
    audience.hub_user_id::text,
    v_template,
    'marketing',
    p_deep_link,
    v_campaign_id,
    'notif:campaign:' || v_campaign_id::text || ':' || audience.hub_user_id::text,
    jsonb_build_object(
      'campaignId', v_campaign_id,
      'title', btrim(p_title),
      'body', btrim(p_body)
    )
  FROM v_web_push_marketing_audience audience;

  GET DIAGNOSTICS v_queued = ROW_COUNT;

  UPDATE web_push_campaigns
  SET audience_count = v_audience,
      queued_count = v_queued,
      status = CASE WHEN v_queued = 0 THEN 'no_audience' ELSE 'queued' END
  WHERE id = v_campaign_id;

  RETURN QUERY SELECT v_campaign_id, v_audience, v_queued;
END
$$;

ALTER TABLE web_push_campaigns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON web_push_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_web_push_marketing_audience FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_web_push_campaign_delivery_stats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_web_push_campaign(text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON web_push_campaigns TO service_role;
GRANT SELECT ON v_web_push_marketing_audience TO service_role;
GRANT SELECT ON v_web_push_campaign_delivery_stats TO service_role;
GRANT EXECUTE ON FUNCTION create_web_push_campaign(text,text,text,text,text,text)
  TO service_role;
