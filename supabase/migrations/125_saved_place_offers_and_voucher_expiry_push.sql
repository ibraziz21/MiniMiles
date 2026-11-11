-- 125_saved_place_offers_and_voucher_expiry_push.sql
-- Two server-side pushes:
--
--   saved_place_offer — "New offer at <merchant>" for members who saved
--     that merchant (hub_user_saved_merchants, 074), once an offer first
--     becomes visible in the app.
--   voucher_expiring  — "Your voucher expires tomorrow" for a member's
--     unused voucher, once, about a day before it expires.
--
-- Both go through notification_outbox like every other push, so preferences
-- (category `vouchers`, on by default), the in-app list and both transports
-- apply unchanged. This migration adds the two templates to the push
-- whitelist and the two producers as RPCs, called by hub-page crons
-- (/api/internal/process-offer-alerts, /api/internal/queue-voucher-expiry-reminders).
--
-- Neither push is sent between 21:00 and 09:00 Nairobi time. The producers
-- simply wait: an offer seen at night is recorded the next morning, and a
-- voucher's reminder window is wide enough to always include daytime hours.
--
-- Neither new table holds a member id, so neither needs an account-deletion
-- executor: sightings are about offers, and a reminder row is keyed by the
-- voucher it cascades with.

-- ── Quiet hours ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION akiba_push_daytime(p_now timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT extract(hour FROM p_now AT TIME ZONE 'Africa/Nairobi') BETWEEN 9 AND 20
$$;

-- ── Offer sightings ──────────────────────────────────────────────────────
-- An offer is "new" the first time the scanner sees it live. Keys are
-- `<source>:<id>` (merchant_offer / funded / template). An offer that goes
-- away and comes back keeps its row, so it is never announced twice.
CREATE TABLE IF NOT EXISTS hub_offer_sightings (
  offer_key     text        PRIMARY KEY,
  source        text        NOT NULL,
  title         text        NOT NULL,
  merchant_ids  uuid[]      NOT NULL DEFAULT '{}',
  announced     boolean     NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

-- A source's first scan records what is already live without announcing it;
-- otherwise deploying this would push every existing offer at once.
CREATE TABLE IF NOT EXISTS hub_offer_sighting_sources (
  source        text        PRIMARY KEY,
  baselined_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_offer_sightings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_offer_sighting_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_offer_sightings, hub_offer_sighting_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON hub_offer_sightings, hub_offer_sighting_sources TO service_role;

-- p_offers: [{ "key": "funded:<id>", "title": "...",
--              "merchants": [{ "id": "<uuid>", "name": "...", "slug": "..." }] }]
--
-- Each member gets at most one of these pushes a day. When several saved
-- places post offers together, the member hears about one; the rest are in
-- the app. Only members who saved the place before the offer appeared are
-- told — saving a place is not a request for its back catalogue.
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

-- ── Voucher expiry reminders ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_voucher_expiry_reminders (
  voucher_id  uuid        PRIMARY KEY REFERENCES issued_vouchers(id) ON DELETE CASCADE,
  reminded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_voucher_expiry_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_voucher_expiry_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON hub_voucher_expiry_reminders TO service_role;

-- Run hourly. A voucher is due when it is unused and expires 2–26 hours
-- from now; that window always contains daytime hours, so every voucher
-- gets its chance. Vouchers that lived two days or less are skipped — the
-- member took them knowing they were short.
--
-- One push per member per run: two vouchers expiring together become
-- "2 vouchers expire soon", not two pushes. Every voucher covered is
-- recorded, so none is reminded twice.
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

-- ── enqueue_web_push_job: whitelist the two templates ────────────────────
-- Reproduced from 123_contribution_request_push.sql; the only change is the
-- two template names. Both are category `vouchers`, already allowed.
CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND NEW.category IN ('orders', 'refunds', 'vouchers', 'rewards', 'earnings')
     AND NEW.template IN (
       'order_placed', 'order_accepted', 'order_dispatched',
       'order_delivered', 'digital_delivered', 'order_cancelled',
       'refund_initiated', 'refund_completed', 'refund_failed',
       'voucher_ready', 'voucher_failed', 'voucher_reconciliation',
       'referral_signup_held', 'referral_signup_released',
       'referral_activation_held', 'referral_activation_released',
       'referral_manual_review',
       'miles_earned',
       'contribution_requested',
       'saved_place_offer',
       'voucher_expiring'
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id, available_at)
    VALUES (
      NEW.id,
      NEW.hub_user_id,
      CASE WHEN NEW.template = 'contribution_requested'
        THEN now() + interval '45 minutes'
        ELSE now()
      END
    )
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
