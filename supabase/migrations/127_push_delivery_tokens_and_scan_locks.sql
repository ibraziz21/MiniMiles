-- 127_push_delivery_tokens_and_scan_locks.sql
-- Fixes from the November 2026 audit (docs/audit-handoff-2026-11.md).
--
-- 1. native_push_deliveries.push_token — the Expo token a delivery was sent
--    to. Re-registering keeps the same hub_user_devices row and swaps its
--    token, so a late DeviceNotRegistered receipt for the OLD token used to
--    disable the device's NEW token. The receipt poller now retires a device
--    only while it still holds the token the failed delivery used. Rows from
--    before this migration have no token and never retire a device.
--
-- 2. Test-push deliveries. Settings -> "Send a test notification" sends
--    outside any notification job, so its tickets were never stored and the
--    receipt poller could not tell an accepted test that APNs/FCM rejected
--    from one that arrived. Those sends are now recorded with
--    purpose = 'test' and no job. They are delivery records only — the
--    notification list reads notification_outbox, which they never touch.
--    Account deletion already removes deliveries by device.
--
-- 3. record_offer_sightings and queue_voucher_expiry_reminders take a
--    transaction-level advisory lock, so overlapping runs serialise and the
--    one-alert-per-member-per-day cap holds. Both are reproduced from 125
--    unchanged apart from the lock.

-- ── 1 & 2. Deliveries ───────────────────────────────────────────────────
ALTER TABLE native_push_deliveries
  ADD COLUMN IF NOT EXISTS push_token text,
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'notification';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'native_push_deliveries'::regclass
       AND conname = 'chk_native_push_deliveries_purpose'
  ) THEN
    ALTER TABLE native_push_deliveries
      ADD CONSTRAINT chk_native_push_deliveries_purpose
      CHECK (purpose IN ('notification', 'test'));
  END IF;
  -- Every notification delivery still belongs to a job; only a test may not.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'native_push_deliveries'::regclass
       AND conname = 'chk_native_push_deliveries_job'
  ) THEN
    ALTER TABLE native_push_deliveries
      ADD CONSTRAINT chk_native_push_deliveries_job
      CHECK (purpose = 'test' OR job_id IS NOT NULL);
  END IF;
END $$;

ALTER TABLE native_push_deliveries ALTER COLUMN job_id DROP NOT NULL;

-- ── 3. Serialised scans ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_offer_sightings(
  p_source text,
  p_offers jsonb,
  p_now    timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new    integer := 0;
  v_queued integer := 0;
BEGIN
  -- One scan at a time (127). The once-a-day cap reads the outbox and then
  -- writes to it; two overlapping scans could both see "nothing today" for
  -- the same member and each send a different offer.
  PERFORM pg_advisory_xact_lock(hashtext('record_offer_sightings'));

  IF p_source NOT IN ('merchant_offer', 'funded', 'template') THEN
    RAISE EXCEPTION 'unknown offer source: %', p_source;
  END IF;
  IF jsonb_typeof(p_offers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_offers must be a JSON array';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.offer_sighting_input (
    offer_key text PRIMARY KEY,
    title     text NOT NULL,
    merchants jsonb NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.offer_sighting_input;

  INSERT INTO pg_temp.offer_sighting_input (offer_key, title, merchants)
  SELECT DISTINCT ON (o->>'key')
         o->>'key',
         left(btrim(coalesce(o->>'title', '')), 80),
         -- Only well-formed merchant ids survive, so one bad entry can't
         -- fail the cast for the whole batch.
         coalesce((
           SELECT jsonb_agg(m)
             FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(o->'merchants') = 'array' THEN o->'merchants' ELSE '[]'::jsonb END
                  ) m
            WHERE m->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         ), '[]'::jsonb)
    FROM jsonb_array_elements(p_offers) o
   WHERE jsonb_typeof(o) = 'object'
     AND o->>'key' LIKE p_source || ':%'
     AND length(o->>'key') <= 200
     AND btrim(coalesce(o->>'title', '')) <> '';

  IF NOT EXISTS (SELECT 1 FROM hub_offer_sighting_sources WHERE source = p_source) THEN
    INSERT INTO hub_offer_sightings (offer_key, source, title, merchant_ids, announced, first_seen_at)
    SELECT offer_key, p_source, title,
           ARRAY(SELECT (m->>'id')::uuid FROM jsonb_array_elements(merchants) m),
           false, p_now
      FROM pg_temp.offer_sighting_input
    ON CONFLICT (offer_key) DO NOTHING;
    INSERT INTO hub_offer_sighting_sources (source, baselined_at) VALUES (p_source, p_now)
    ON CONFLICT (source) DO NOTHING;
    RETURN jsonb_build_object('baselined', true, 'new_offers', 0, 'queued', 0);
  END IF;

  -- At night nothing is recorded, so tonight's offers are still "new" in
  -- the morning.
  IF NOT akiba_push_daytime(p_now) THEN
    RETURN jsonb_build_object('baselined', false, 'quiet_hours', true, 'new_offers', 0, 'queued', 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.offer_sighting_new (
    offer_key text PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.offer_sighting_new;

  WITH inserted AS (
    INSERT INTO hub_offer_sightings (offer_key, source, title, merchant_ids, announced, first_seen_at)
    SELECT offer_key, p_source, title,
           ARRAY(SELECT (m->>'id')::uuid FROM jsonb_array_elements(merchants) m),
           true, p_now
      FROM pg_temp.offer_sighting_input
    ON CONFLICT (offer_key) DO NOTHING
    RETURNING offer_key
  )
  INSERT INTO pg_temp.offer_sighting_new (offer_key) SELECT offer_key FROM inserted;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  WITH candidates AS (
    SELECT s.hub_user_id,
           i.offer_key,
           i.title,
           s.merchant_id,
           left(btrim(coalesce(m->>'name', '')), 60) AS merchant_name,
           m->>'slug' AS merchant_slug
      FROM pg_temp.offer_sighting_new n
      JOIN pg_temp.offer_sighting_input i ON i.offer_key = n.offer_key
      CROSS JOIN LATERAL jsonb_array_elements(i.merchants) m
      JOIN hub_user_saved_merchants s
        ON s.merchant_id = (m->>'id')::uuid
       AND s.created_at < p_now
  ),
  chosen AS (
    SELECT DISTINCT ON (c.hub_user_id) c.*
      FROM candidates c
     WHERE NOT EXISTS (
       SELECT 1 FROM notification_outbox o
        WHERE o.user_ref = c.hub_user_id::text
          AND o.template = 'saved_place_offer'
          AND o.created_at > p_now - interval '24 hours'
     )
     ORDER BY c.hub_user_id, c.offer_key, c.merchant_id
  ),
  queued AS (
    INSERT INTO notification_outbox (user_ref, hub_user_id, template, category, deep_link, dedupe_key, metadata, created_at)
    SELECT c.hub_user_id::text,
           c.hub_user_id,
           'saved_place_offer',
           'vouchers',
           CASE WHEN c.merchant_slug ~ '^[A-Za-z0-9_-]{1,64}$'
             THEN '/merchants/' || c.merchant_slug
             ELSE '/merchants'
           END,
           'notif:saved-offer:' || c.hub_user_id || ':' || c.offer_key,
           jsonb_build_object(
             'offerKey', c.offer_key,
             'offerTitle', c.title,
             'merchantId', c.merchant_id,
             'merchantName', nullif(c.merchant_name, '')
           ),
           p_now
      FROM chosen c
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_queued FROM queued;

  RETURN jsonb_build_object('baselined', false, 'new_offers', v_new, 'queued', v_queued);
END
$$;

REVOKE ALL ON FUNCTION record_offer_sightings(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_offer_sightings(text, jsonb, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION queue_voucher_expiry_reminders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queued integer := 0;
BEGIN
  IF NOT akiba_push_daytime(p_now) THEN
    RETURN 0;
  END IF;

  -- One run at a time (127), so two overlapping runs can't group the same
  -- member's vouchers differently and both send.
  PERFORM pg_advisory_xact_lock(hashtext('queue_voucher_expiry_reminders'));

  WITH due AS (
    SELECT iv.id,
           iv.hub_user_id,
           iv.expires_at,
           left(btrim(coalesce(t.title, '')), 80) AS title,
           left(btrim(coalesce(p.name, '')), 60) AS merchant_name
      FROM issued_vouchers iv
      LEFT JOIN spend_voucher_templates t ON t.id = iv.voucher_template_id
      LEFT JOIN partners p ON p.id = t.partner_id
     WHERE iv.status = 'issued'
       AND iv.hub_user_id IS NOT NULL
       AND iv.redeemed_at IS NULL
       AND iv.expires_at >  p_now + interval '2 hours'
       AND iv.expires_at <= p_now + interval '26 hours'
       AND iv.expires_at - iv.created_at > interval '48 hours'
       AND NOT EXISTS (SELECT 1 FROM hub_voucher_expiry_reminders r WHERE r.voucher_id = iv.id)
  ),
  grouped AS (
    SELECT hub_user_id,
           array_agg(id ORDER BY expires_at, id) AS voucher_ids,
           min(expires_at) AS first_expires_at,
           (array_agg(title ORDER BY expires_at, id))[1] AS title,
           (array_agg(merchant_name ORDER BY expires_at, id))[1] AS merchant_name
      FROM due
     GROUP BY hub_user_id
  ),
  queued AS (
    INSERT INTO notification_outbox (user_ref, hub_user_id, template, category, deep_link, dedupe_key, metadata, created_at)
    SELECT g.hub_user_id::text,
           g.hub_user_id,
           'voucher_expiring',
           'vouchers',
           CASE WHEN cardinality(g.voucher_ids) = 1
             THEN '/my-vouchers?voucher=' || g.voucher_ids[1]
             ELSE '/my-vouchers'
           END,
           'notif:voucher-expiring:' || g.voucher_ids[1],
           jsonb_build_object(
             'voucherIds', to_jsonb(g.voucher_ids),
             'count', cardinality(g.voucher_ids),
             'expiresAt', g.first_expires_at,
             'title', nullif(g.title, ''),
             'merchantName', nullif(g.merchant_name, '')
           ),
           p_now
      FROM grouped g
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ),
  -- Runs whether or not anything reads it (data-modifying CTEs always do).
  marked AS (
    INSERT INTO hub_voucher_expiry_reminders (voucher_id, reminded_at)
    SELECT unnest(g.voucher_ids), p_now FROM grouped g
    ON CONFLICT (voucher_id) DO NOTHING
  )
  SELECT count(*) INTO v_queued FROM queued;

  RETURN v_queued;
END
$$;

REVOKE ALL ON FUNCTION queue_voucher_expiry_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION queue_voucher_expiry_reminders(timestamptz) TO service_role;
