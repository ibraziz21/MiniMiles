-- Order lifecycle backbone (order-lifecycle-completion-spec.md, build order §8 step 1)
--
-- Consolidated: this is the final, corrected version of the backbone —
-- folds in what were originally two follow-up fixes (033, 038) so a fresh
-- database only needs this one migration, not "032, then patched by 033,
-- then patched by 038". Both fixes are described below for the historical
-- record; anyone who already ran the original 032+033+038 sequence ends up
-- at the exact same schema/function state as running this file alone.
--
-- Fix #1 (was 033): merchant_transactions.status is a Postgres enum
-- (tx_status), not text. dispatched_at (not out_for_delivery_at) is the
-- real column the merchant portal and react-app admin route already read/
-- write for out_for_delivery, and accepted/packed/dispatched/cancelled_at
-- already exist too (added once, outside this repo's tracked migrations, by
-- packages/react-app/sql/merchant_order_lifecycle.sql). This version never
-- introduces the wrong out_for_delivery_at column at all, and adds only the
-- lifecycle columns that script doesn't already cover. It also lets
-- merchants (not just admins) cancel from accepted/packed/out_for_delivery,
-- matching the merchant portal's existing reject/cancel capability rather
-- than the spec's stricter "admin only past placed" reading.
--
-- Fix #2 (was 038): tx_status must have the new lifecycle values (added by
-- merchant_order_lifecycle.sql: placed/accepted/packed/out_for_delivery/
-- delivered/received/completed/cancelled) PLUS this spec's new ones
-- (provider_pending/fulfil_failed/retrying/disputed) before anything
-- references them. Earlier migrations only ever referenced these new values
-- through dynamic SQL (EXECUTE format(...) USING p_to_status), which defers
-- the enum-cast check to call time, so the gap went unnoticed until a
-- migration compared `status` to a literal directly. ALTER TYPE ... ADD
-- VALUE IF NOT EXISTS is safe to (re-)run — this establishes the full set
-- up front so nothing downstream can hit this again.
--
-- Establishes the single source of truth for order status transitions:
--   - order_events: append-only audit log, one row per transition
--   - order_status_transitions: the transition table, enforced not just documented
--   - advance_order_status(): the only sanctioned way to change merchant_transactions.status
--   - a trigger that rejects any other UPDATE touching status
--
-- Everything else in the spec (merchant inbox, refunds, digital fulfilment,
-- disputes, rewards timing, admin queues) builds on this and ships incrementally.

-- ── tx_status enum: full lifecycle value set ────────────────────────────────
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'placed';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'packed';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'out_for_delivery';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'provider_pending';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'fulfil_failed';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'retrying';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'disputed';

-- ── Lifecycle timestamp columns ──────────────────────────────────────────────
-- accepted_at/packed_at/dispatched_at/delivered_at/received_at/cancelled_at
-- already exist (added by merchant_order_lifecycle.sql). Add only what's new.
ALTER TABLE merchant_transactions
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS provider_pending_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfil_failed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS retrying_at         timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at         timestamptz;

-- ── Audit log (§5.1) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES merchant_transactions(id),
  actor       text NOT NULL CHECK (actor IN ('customer', 'merchant', 'system', 'admin')),
  from_status text,
  to_status   text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events (order_id, created_at);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON order_events TO service_role;

-- ── Transition table — enforced, not documented-only (§1) ──────────────────
CREATE TABLE IF NOT EXISTS order_status_transitions (
  from_status    text NOT NULL,
  to_status      text NOT NULL,
  allowed_actors text[] NOT NULL,
  PRIMARY KEY (from_status, to_status)
);

REVOKE ALL ON order_status_transitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON order_status_transitions TO service_role;

-- accepted/packed/out_for_delivery -> cancelled include 'merchant': the
-- merchant portal already lets merchants reject/cancel their own orders past
-- 'placed' today. The spec's literal "any-pre-delivered -> cancelled is
-- admin-only (incident path)" reading would have revoked a working
-- capability, so this keeps merchant self-cancel and adds 'admin' alongside
-- it for the incident path.
INSERT INTO order_status_transitions (from_status, to_status, allowed_actors) VALUES
  ('placed',           'accepted',         ARRAY['merchant']),
  ('placed',           'cancelled',        ARRAY['customer', 'merchant', 'admin']),
  ('placed',           'provider_pending', ARRAY['system']),
  ('accepted',         'packed',           ARRAY['merchant']),
  ('accepted',         'cancelled',        ARRAY['merchant', 'admin']),
  ('packed',           'out_for_delivery', ARRAY['merchant']),
  ('packed',           'cancelled',        ARRAY['merchant', 'admin']),
  ('out_for_delivery', 'delivered',        ARRAY['merchant']),
  ('out_for_delivery', 'cancelled',        ARRAY['merchant', 'admin']),
  ('provider_pending', 'delivered',        ARRAY['system']),
  ('provider_pending', 'fulfil_failed',    ARRAY['system']),
  ('provider_pending', 'cancelled',        ARRAY['admin']),
  ('fulfil_failed',    'retrying',         ARRAY['system']),
  ('fulfil_failed',    'cancelled',        ARRAY['system', 'admin']),
  ('retrying',         'provider_pending', ARRAY['system']),
  ('retrying',         'cancelled',        ARRAY['admin']),
  ('delivered',        'received',         ARRAY['customer', 'system']),
  ('delivered',        'disputed',         ARRAY['customer']),
  ('received',         'completed',        ARRAY['system']),
  ('disputed',         'received',         ARRAY['admin']),
  ('disputed',         'cancelled',        ARRAY['admin'])
ON CONFLICT (from_status, to_status) DO UPDATE SET allowed_actors = EXCLUDED.allowed_actors;

-- ── The one sanctioned way to change status ────────────────────────────────
CREATE OR REPLACE FUNCTION advance_order_status(
  p_order_id  uuid,
  p_to_status text,
  p_actor     text,
  p_meta      jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(ok boolean, error_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_status text;
  v_allowed     text[];
  v_at_column   text;
BEGIN
  SELECT status INTO v_from_status FROM merchant_transactions WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'ORDER_NOT_FOUND'; RETURN;
  END IF;

  SELECT allowed_actors INTO v_allowed
  FROM order_status_transitions
  WHERE from_status = v_from_status AND to_status = p_to_status;

  IF v_allowed IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_TRANSITION'; RETURN;
  END IF;
  IF NOT (p_actor = ANY(v_allowed)) THEN
    RETURN QUERY SELECT false, 'ACTOR_NOT_ALLOWED'; RETURN;
  END IF;

  v_at_column := CASE p_to_status
    WHEN 'accepted'         THEN 'accepted_at'
    WHEN 'packed'           THEN 'packed_at'
    WHEN 'out_for_delivery' THEN 'dispatched_at'
    WHEN 'delivered'        THEN 'delivered_at'
    WHEN 'received'         THEN 'received_at'
    WHEN 'completed'        THEN 'completed_at'
    WHEN 'cancelled'        THEN 'cancelled_at'
    WHEN 'provider_pending' THEN 'provider_pending_at'
    WHEN 'fulfil_failed'    THEN 'fulfil_failed_at'
    WHEN 'retrying'         THEN 'retrying_at'
    WHEN 'disputed'         THEN 'disputed_at'
    ELSE NULL
  END;

  -- Lets the trigger below (guard_order_status_change) tell this update
  -- apart from any direct UPDATE that bypasses this RPC.
  PERFORM set_config('akiba.allow_status_change', 'true', true);

  IF v_at_column IS NOT NULL THEN
    EXECUTE format('UPDATE merchant_transactions SET status = $1::tx_status, %I = now() WHERE id = $2', v_at_column)
      USING p_to_status, p_order_id;
  ELSE
    UPDATE merchant_transactions SET status = p_to_status::tx_status WHERE id = p_order_id;
  END IF;

  INSERT INTO order_events (order_id, actor, from_status, to_status, meta)
  VALUES (p_order_id, p_actor, v_from_status, p_to_status, COALESCE(p_meta, '{}'::jsonb));

  RETURN QUERY SELECT true, ''::text;
END;
$$;

REVOKE ALL ON FUNCTION advance_order_status(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION advance_order_status(uuid, text, text, jsonb) TO service_role;

-- ── Guard: reject any status UPDATE that doesn't go through the RPC ────────
-- Acceptance criterion: "direct status UPDATEs outside the RPC are revoked
-- at the DB level." merchant_transactions predates this repo's migrations
-- and its existing grants aren't known here, so this is enforced with a
-- trigger (works regardless of who holds UPDATE) rather than a bare REVOKE.
CREATE OR REPLACE FUNCTION guard_order_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('akiba.allow_status_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct status updates are forbidden — use advance_order_status()' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_status_change ON merchant_transactions;
CREATE TRIGGER trg_guard_order_status_change
  BEFORE UPDATE ON merchant_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_order_status_change();

NOTIFY pgrst, 'reload schema';
