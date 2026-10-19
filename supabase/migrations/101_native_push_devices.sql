-- 101_native_push_devices.sql
-- Native (Expo/APNs/FCM) push device registry and delivery audit.
-- See packages/hub-page/docs/hub-mobile-app-migration-plan.md
-- §"Push notifications" and §"Phase 5 — Native push, deep links, deletion".
--
-- Why a second table rather than widening web_push_subscriptions: that table
-- is W3C Web Push shaped (endpoint + p256dh + auth_secret, all NOT NULL) and
-- the plan is explicit that Expo push tokens must not be forced into it.
--
-- What is deliberately NOT duplicated: the job queue. notification_outbox ->
-- trg_notification_outbox_enqueue_push -> web_push_jobs stays the single
-- queue, because one notification is one "did we tell this member" decision
-- regardless of how many transports it fans out to. The dispatcher claims a
-- job once (claim_web_push_jobs) and reports one combined outcome
-- (complete_web_push_job), so retry/backoff and terminal-state protection are
-- shared and cannot disagree between transports. Only the per-target delivery
-- rows are transport-specific, which is what this migration adds.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Device registry ───────────────────────────────────────────────────────
-- Column set follows the plan's `hub_user_devices` sketch. Both token columns
-- exist from the start: `expo_push_token` is what the first release sends
-- through (Expo Push), `native_device_token` is the reserved direct APNs/FCM
-- path, so moving transports later is an additive change rather than a
-- rewrite of this table and everything that reads it.
CREATE TABLE IF NOT EXISTS hub_user_devices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id     uuid NOT NULL,
  platform            text NOT NULL CHECK (platform IN ('ios', 'android')),
  -- Plain UNIQUE, not a partial index: ON CONFLICT inference needs a total
  -- unique index to target, and the registration route upserts on this
  -- column. Postgres permits many NULLs under a UNIQUE constraint, so rows on
  -- the future direct-token path are unaffected.
  expo_push_token     text UNIQUE,
  native_device_token text UNIQUE,
  app_version         text,
  build_number        text,
  locale              text,
  timezone            text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'invalid')),
  failure_count       integer NOT NULL DEFAULT 0,
  last_success_at     timestamptz,
  last_failure_at     timestamptz,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- An *active* registration with neither token can never be sent to, so it
  -- is a bug at the call site rather than a row to carry around. A revoked
  -- row is allowed to have surrendered its token: when a token is handed to
  -- a different account (same phone, new sign-in) the previous owner's row
  -- must give it up to satisfy the UNIQUE above, and keeping that row —
  -- tokenless and revoked — is what preserves its delivery audit trail
  -- instead of cascading it away.
  CONSTRAINT chk_hub_user_devices_active_has_token
    CHECK (
      status <> 'active'
      OR expo_push_token IS NOT NULL
      OR native_device_token IS NOT NULL
    )
);

-- The dispatcher's only lookup: active devices for one member.
CREATE INDEX IF NOT EXISTS idx_hub_user_devices_user_active
  ON hub_user_devices(hub_user_id)
  WHERE status = 'active';

-- Re-registration from the same install replaces rather than accumulates
-- (a token can rotate while the installation stays the same).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_user_devices_installation
  ON hub_user_devices(hub_user_id, installation_id);

DROP TRIGGER IF EXISTS trg_hud_touch_updated_at ON hub_user_devices;
CREATE TRIGGER trg_hud_touch_updated_at
  BEFORE UPDATE ON hub_user_devices
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE hub_user_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_user_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hub_user_devices TO service_role;

-- ── Delivery attempts (one per job x device) ──────────────────────────────
-- Mirrors web_push_deliveries exactly, including its status vocabulary, so
-- the two transports normalise into the same audit shape. Kept as its own
-- table because web_push_deliveries.subscription_id is NOT NULL and its
-- UNIQUE(job_id, subscription_id) is what the web adapter's upsert infers;
-- making that column nullable would silently break that inference, since
-- Postgres allows many NULL pairs under the same constraint.
CREATE TABLE IF NOT EXISTS native_push_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES web_push_jobs(id) ON DELETE CASCADE,
  device_id        uuid NOT NULL REFERENCES hub_user_devices(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'retry', 'gone', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  provider_status  integer,
  -- Expo returns a ticket id per message; keeping it is what makes a later
  -- receipt-polling pass possible without re-deriving which send was which.
  provider_ticket  text,
  last_error       text,
  accepted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_native_push_deliveries_device
  ON native_push_deliveries(device_id);

DROP TRIGGER IF EXISTS trg_npd_touch_updated_at ON native_push_deliveries;
CREATE TRIGGER trg_npd_touch_updated_at
  BEFORE UPDATE ON native_push_deliveries
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

ALTER TABLE native_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON native_push_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON native_push_deliveries TO service_role;

NOTIFY pgrst, 'reload schema';
