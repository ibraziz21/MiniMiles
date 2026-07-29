-- 046_hub_miles_spend_intents.sql
-- Durable Hub voucher purchases for ledger-only, on-chain, and split funding.
--
-- The important invariants are enforced here, not in application code:
--   * one hash-bound idempotency key -> one intent/voucher/job
--   * ledger funds remain active holds until the whole purchase succeeds
--   * a signed transaction is durably associated with its intent before broadcast
--   * voucher issuance, ledger settlement, job completion, and audit events commit
--     together
--   * only intents with no signed transaction may expire automatically

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Legacy voucher ownership ──────────────────────────────────────────────────
-- New walletless vouchers are owned by hub_user_id and have no address.
ALTER TABLE issued_vouchers ALTER COLUMN user_address DROP NOT NULL;
ALTER TABLE issued_vouchers ADD COLUMN IF NOT EXISTS burn_tx_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'issued_vouchers'::regclass
      AND conname = 'chk_issued_voucher_owner'
  ) THEN
    ALTER TABLE issued_vouchers
      ADD CONSTRAINT chk_issued_voucher_owner
      CHECK (hub_user_id IS NOT NULL OR user_address IS NOT NULL) NOT VALID;
  END IF;
END
$$;

-- ── Canonical burn queue schema ───────────────────────────────────────────────
-- This used to live only in packages/react-app/sql. Keeping its additive schema
-- here makes a fresh Supabase migration install sufficient for Hub purchases.
CREATE TABLE IF NOT EXISTS minipoint_burn_jobs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key       text        NOT NULL UNIQUE,
  user_address          text        NOT NULL,
  points                integer     NOT NULL CHECK (points > 0),
  reason                text,
  status                text        NOT NULL DEFAULT 'pending',
  tx_hash               text,
  raw_signed_tx         text,
  nonce                 bigint,
  last_error             text,
  attempts              integer     NOT NULL DEFAULT 0,
  available_at          timestamptz NOT NULL DEFAULT now(),
  payload               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  processing_by         text,
  processing_started_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE minipoint_burn_jobs
  ADD COLUMN IF NOT EXISTS raw_signed_tx text,
  ADD COLUMN IF NOT EXISTS nonce bigint;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'minipoint_burn_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE minipoint_burn_jobs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE minipoint_burn_jobs
  ADD CONSTRAINT chk_minipoint_burn_job_status
  CHECK (status IN ('pending','processing','completed','failed','reconciliation_required'));

CREATE INDEX IF NOT EXISTS minipoint_burn_jobs_status_available_idx
  ON minipoint_burn_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS minipoint_burn_jobs_user_status_idx
  ON minipoint_burn_jobs(user_address, status);

CREATE TABLE IF NOT EXISTS minipoint_burn_queue_locks (
  lock_name   text        PRIMARY KEY,
  owner       text        NOT NULL,
  locked_until timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION touch_minipoint_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS minipoint_burn_jobs_touch_updated_at ON minipoint_burn_jobs;
CREATE TRIGGER minipoint_burn_jobs_touch_updated_at
  BEFORE UPDATE ON minipoint_burn_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_minipoint_updated_at();

-- ── User-confirmed quotes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_purchase_quotes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_key       text        NOT NULL UNIQUE,
  request_hash       text        NOT NULL,
  hub_user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id        uuid        NOT NULL REFERENCES spend_voucher_templates(id),
  merchant_id        uuid        NOT NULL REFERENCES partners(id),
  wallet_address     text,
  ledger_points      integer     NOT NULL CHECK (ledger_points >= 0),
  onchain_points     integer     NOT NULL CHECK (onchain_points >= 0),
  total_points       integer     NOT NULL CHECK (total_points > 0),
  disclosure_version text        NOT NULL,
  consumed           boolean     NOT NULL DEFAULT false,
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vpq_split_sums
    CHECK (ledger_points + onchain_points = total_points),
  CONSTRAINT chk_vpq_wallet_for_chain
    CHECK (onchain_points = 0 OR wallet_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vpq_hub_user
  ON voucher_purchase_quotes(hub_user_id, created_at DESC);

-- ── Canonical spend intent and per-canonical ledger holds ─────────────────────
CREATE TABLE IF NOT EXISTS miles_spend_intents (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key         text        NOT NULL UNIQUE,
  request_hash            text        NOT NULL,
  hub_user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  wallet_address          text,
  voucher_id              uuid        NOT NULL UNIQUE REFERENCES issued_vouchers(id),
  template_id             uuid        NOT NULL REFERENCES spend_voucher_templates(id),
  merchant_id             uuid        NOT NULL REFERENCES partners(id),
  total_points            integer     NOT NULL CHECK (total_points > 0),
  ledger_points           integer     NOT NULL DEFAULT 0 CHECK (ledger_points >= 0),
  onchain_points          integer     NOT NULL DEFAULT 0 CHECK (onchain_points >= 0),
  consent_method          text        NOT NULL
                            CHECK (consent_method IN ('wallet_signature','hub_ui_confirmed')),
  disclosure_version      text        NOT NULL,
  quote_id                uuid        UNIQUE REFERENCES voucher_purchase_quotes(id),
  burn_job_id             uuid        UNIQUE REFERENCES minipoint_burn_jobs(id),
  submitted_tx_hash       text,
  submitted_at            timestamptz,
  confirmed_at            timestamptz,
  failed_at               timestamptz,
  state                   text        NOT NULL DEFAULT 'reserved'
                            CHECK (state IN (
                              'reserved',
                              'onchain_prepared',
                              'onchain_submitted',
                              'finalized',
                              'failed',
                              'reconciliation_required'
                            )),
  failure_code            text,
  failure_reason          text,
  reservation_expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_msi_split_sums
    CHECK (ledger_points + onchain_points = total_points),
  CONSTRAINT chk_msi_wallet_required_for_onchain
    CHECK (onchain_points = 0 OR wallet_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_msi_hub_user
  ON miles_spend_intents(hub_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msi_state_expiry
  ON miles_spend_intents(state, reservation_expires_at);
CREATE INDEX IF NOT EXISTS idx_msi_tx_hash
  ON miles_spend_intents(submitted_tx_hash)
  WHERE submitted_tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS miles_ledger_holds (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id  uuid        NOT NULL,
  hub_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  intent_id     uuid        NOT NULL REFERENCES miles_spend_intents(id),
  points        integer     NOT NULL CHECK (points > 0),
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','released','consumed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mlh_intent_canonical UNIQUE(intent_id, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_mlh_canonical_status
  ON miles_ledger_holds(canonical_id, status);
CREATE INDEX IF NOT EXISTS idx_mlh_intent
  ON miles_ledger_holds(intent_id);

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_msi_touch_updated_at ON miles_spend_intents;
CREATE TRIGGER trg_msi_touch_updated_at
  BEFORE UPDATE ON miles_spend_intents
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mlh_touch_updated_at ON miles_ledger_holds;
CREATE TRIGGER trg_mlh_touch_updated_at
  BEFORE UPDATE ON miles_ledger_holds
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- These tables are service-only. Hub routes use the service-role client and
-- expose scoped response DTOs rather than direct table access.
ALTER TABLE voucher_purchase_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE miles_spend_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE miles_ledger_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON voucher_purchase_quotes, miles_spend_intents, miles_ledger_holds
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON voucher_purchase_quotes, miles_spend_intents, miles_ledger_holds
  TO service_role;

-- ── Canonical identity and available ledger balance ───────────────────────────
CREATE OR REPLACE FUNCTION resolve_canonical_ids(p_email text, p_wallets text[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT canonical_id
    FROM identity_links
    WHERE (
      p_email IS NOT NULL
      AND identity_type = 'email'
      AND identity_value = lower(trim(p_email))
    ) OR (
      p_wallets IS NOT NULL
      AND identity_type = 'wallet'
      AND identity_value = ANY(
        ARRAY(SELECT lower(trim(value)) FROM unnest(p_wallets) AS w(value))
      )
    )
    ORDER BY canonical_id
  ), '{}'::uuid[]);
$$;

CREATE OR REPLACE FUNCTION available_ledger_points(p_canonical_ids uuid[])
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (
    COALESCE((
      SELECT SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
      FROM miles_ledger
      WHERE canonical_id = ANY(COALESCE(p_canonical_ids, '{}'::uuid[]))
        AND on_chain = false
    ), 0)
    -
    COALESCE((
      SELECT SUM(points)
      FROM miles_ledger_holds
      WHERE canonical_id = ANY(COALESCE(p_canonical_ids, '{}'::uuid[]))
        AND status = 'active'
    ), 0)
  )::integer;
$$;

REVOKE ALL ON FUNCTION resolve_canonical_ids(text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION available_ledger_points(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_canonical_ids(text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION available_ledger_points(uuid[]) TO service_role;

-- ── Shared burn reservation and queue functions ──────────────────────────────
CREATE OR REPLACE FUNCTION reserve_miles_burn(
  p_user_address    text,
  p_points          integer,
  p_onchain_balance numeric,
  p_idempotency_key text,
  p_reason          text,
  p_payload         jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(job_id uuid, already_existed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserved numeric;
  v_job      minipoint_burn_jobs%ROWTYPE;
  v_address  text := lower(trim(p_user_address));
BEGIN
  IF v_address IS NULL OR v_address = '' THEN
    RAISE EXCEPTION 'WALLET_REQUIRED_FOR_ONCHAIN_PORTION' USING ERRCODE = 'P0001';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'INVALID_BURN_POINTS' USING ERRCODE = 'P0001';
  END IF;

  -- This is the canonical lock used by every on-chain reservation path.
  PERFORM pg_advisory_xact_lock(hashtext(v_address));

  SELECT * INTO v_job
  FROM minipoint_burn_jobs
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF lower(v_job.user_address) <> v_address
       OR v_job.points <> p_points
       OR COALESCE(v_job.reason, '') <> COALESCE(p_reason, '')
       OR COALESCE(v_job.payload, '{}'::jsonb) <> COALESCE(p_payload, '{}'::jsonb) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_job.id, true;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_reserved
  FROM minipoint_burn_jobs
  WHERE lower(user_address) = v_address
    AND status IN ('pending','processing','reconciliation_required');

  IF p_onchain_balance - v_reserved < p_points THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: spendable % < requested %',
      p_onchain_balance - v_reserved, p_points
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO minipoint_burn_jobs(
    idempotency_key, user_address, points, reason, payload
  )
  VALUES (
    p_idempotency_key, v_address, p_points, p_reason, COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_job.id;

  RETURN QUERY SELECT v_job.id, false;
END
$$;

CREATE OR REPLACE FUNCTION acquire_minipoint_burn_queue_lock(
  p_lock_name text,
  p_owner text,
  p_lease_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner text;
BEGIN
  INSERT INTO minipoint_burn_queue_locks(lock_name, owner, locked_until)
  VALUES (p_lock_name, p_owner, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT(lock_name) DO UPDATE
    SET owner = EXCLUDED.owner,
        locked_until = EXCLUDED.locked_until,
        updated_at = now()
  WHERE minipoint_burn_queue_locks.locked_until < now()
     OR minipoint_burn_queue_locks.owner = EXCLUDED.owner;

  SELECT owner INTO v_owner
  FROM minipoint_burn_queue_locks
  WHERE lock_name = p_lock_name AND locked_until > now();
  RETURN v_owner = p_owner;
END
$$;

CREATE OR REPLACE FUNCTION release_minipoint_burn_queue_lock(
  p_lock_name text,
  p_owner text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE minipoint_burn_queue_locks
  SET locked_until = now(), updated_at = now()
  WHERE lock_name = p_lock_name AND owner = p_owner;
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION claim_next_minipoint_burn_job(
  p_lock_name text,
  p_owner text
)
RETURNS SETOF minipoint_burn_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM minipoint_burn_queue_locks
    WHERE lock_name = p_lock_name
      AND owner = p_owner
      AND locked_until > now()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE minipoint_burn_jobs
  SET status = 'processing',
      processing_by = p_owner,
      processing_started_at = now(),
      attempts = attempts + 1
  WHERE id = (
    SELECT id
    FROM minipoint_burn_jobs
    WHERE status = 'pending'
      AND available_at <= now()
      AND COALESCE(payload->>'kind', '') <> 'passport_burn'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END
$$;

CREATE OR REPLACE FUNCTION complete_minipoint_burn_job(
  p_job_id uuid,
  p_tx_hash text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE minipoint_burn_jobs
  SET status = 'completed',
      tx_hash = p_tx_hash,
      last_error = NULL,
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION retry_minipoint_burn_job(
  p_job_id uuid,
  p_error text,
  p_delay_seconds integer DEFAULT 5
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE minipoint_burn_jobs
  SET status = 'pending',
      last_error = left(COALESCE(p_error, 'retry'), 2000),
      available_at = now() + make_interval(secs => greatest(p_delay_seconds, 1)),
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id
    AND status = 'processing';
$$;

CREATE OR REPLACE FUNCTION fail_minipoint_burn_job(
  p_job_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE minipoint_burn_jobs
  SET status = 'failed',
      last_error = left(COALESCE(p_error, 'failed'), 2000),
      processing_by = NULL,
      processing_started_at = NULL
  WHERE id = p_job_id;
$$;

REVOKE ALL ON FUNCTION reserve_miles_burn(text,integer,numeric,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_miles_burn(text,integer,numeric,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION acquire_minipoint_burn_queue_lock(text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION release_minipoint_burn_queue_lock(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_next_minipoint_burn_job(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION complete_minipoint_burn_job(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION retry_minipoint_burn_job(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION fail_minipoint_burn_job(uuid,text) TO service_role;

-- ── Catalog availability ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION list_available_voucher_template_ids_hub(
  p_hub_user_id uuid DEFAULT NULL
)
RETURNS TABLE(template_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT svt.id
  FROM spend_voucher_templates svt
  WHERE svt.active = true
    AND (svt.expires_at IS NULL OR svt.expires_at > now())
    AND (
      svt.global_cap IS NULL
      OR (
        SELECT COUNT(*)
        FROM issued_vouchers iv
        WHERE iv.voucher_template_id = svt.id
          AND iv.status NOT IN ('void','expired')
      ) < svt.global_cap
    )
    AND 1 = (
      SELECT COUNT(DISTINCT vp.id)
      FROM voucher_programs vp
      JOIN voucher_program_channel_allocations a
        ON a.program_id = vp.id
       AND a.channel = 'miles_purchase'
       AND a.active = true
      WHERE vp.template_id = svt.id
        AND vp.state = 'active'
        AND (vp.start_at IS NULL OR vp.start_at <= now())
        AND (vp.end_at IS NULL OR vp.end_at > now())
        AND (
          vp.total_cap IS NULL
          OR (
            SELECT COUNT(*) FROM issued_vouchers iv
            WHERE iv.program_id = vp.id AND iv.status <> 'void'
          ) < vp.total_cap
        )
        AND (
          a.cap IS NULL
          OR (
            SELECT COUNT(*) FROM issued_vouchers iv
            WHERE iv.program_id = vp.id
              AND iv.acquisition_source = 'miles_purchase'
              AND iv.status <> 'void'
          ) < a.cap
        )
    )
    AND (
      p_hub_user_id IS NULL
      OR COALESCE(svt.cooldown_seconds, 0) <= 0
      OR NOT EXISTS (
        SELECT 1
        FROM issued_vouchers iv
        WHERE iv.hub_user_id = p_hub_user_id
          AND iv.voucher_template_id = svt.id
          AND iv.status NOT IN ('void','expired')
          AND iv.created_at > now() - make_interval(secs => svt.cooldown_seconds)
      )
    );
$$;

REVOKE ALL ON FUNCTION list_available_voucher_template_ids_hub(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_available_voucher_template_ids_hub(uuid) TO service_role;

-- ── Atomic voucher purchase reservation ───────────────────────────────────────
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

-- ── Worker submission state ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prepare_hub_voucher_burn(
  p_job_id uuid,
  p_intent_id uuid,
  p_tx_hash text,
  p_raw_signed_tx text,
  p_nonce bigint
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
  SELECT * INTO v_intent
  FROM miles_spend_intents WHERE id = p_intent_id FOR UPDATE;
  SELECT * INTO v_job
  FROM minipoint_burn_jobs WHERE id = p_job_id FOR UPDATE;

  IF v_intent.id IS NULL OR v_job.id IS NULL
     OR v_intent.burn_job_id <> p_job_id
     OR v_job.payload->>'intent_id' <> p_intent_id::text
     OR v_job.payload->>'voucher_id' <> v_intent.voucher_id::text THEN
    RAISE EXCEPTION 'BURN_INTENT_ASSOCIATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_intent.state NOT IN ('reserved','onchain_prepared','onchain_submitted') THEN
    RAISE EXCEPTION 'INVALID_INTENT_STATE: %', v_intent.state USING ERRCODE = 'P0001';
  END IF;

  IF v_job.tx_hash IS NOT NULL AND (
    v_job.tx_hash <> p_tx_hash OR v_job.raw_signed_tx <> p_raw_signed_tx OR v_job.nonce <> p_nonce
  ) THEN
    RAISE EXCEPTION 'SIGNED_TRANSACTION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE minipoint_burn_jobs
  SET tx_hash = p_tx_hash, raw_signed_tx = p_raw_signed_tx, nonce = p_nonce
  WHERE id = p_job_id;

  UPDATE miles_spend_intents
  SET submitted_tx_hash = p_tx_hash,
      state = CASE WHEN state = 'reserved' THEN 'onchain_prepared' ELSE state END
  WHERE id = p_intent_id;
END
$$;

CREATE OR REPLACE FUNCTION mark_hub_voucher_burn_submitted(
  p_job_id uuid,
  p_intent_id uuid,
  p_tx_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1
  FROM miles_spend_intents msi
  JOIN minipoint_burn_jobs j ON j.id = msi.burn_job_id
  WHERE msi.id = p_intent_id
    AND j.id = p_job_id
    AND j.tx_hash = p_tx_hash
  FOR UPDATE OF msi, j;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BURN_INTENT_ASSOCIATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE miles_spend_intents
  SET state = 'onchain_submitted',
      submitted_tx_hash = p_tx_hash,
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_intent_id
    AND state IN ('reserved','onchain_prepared','onchain_submitted');
END
$$;

-- ── Atomic worker outcomes ────────────────────────────────────────────────────
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
END
$$;

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
END
$$;

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
BEGIN
  PERFORM 1
  FROM miles_spend_intents msi
  JOIN minipoint_burn_jobs j ON j.id = msi.burn_job_id
  WHERE msi.id = p_intent_id AND j.id = p_job_id
  FOR UPDATE OF msi, j;

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
END
$$;

REVOKE ALL ON FUNCTION prepare_hub_voucher_burn(uuid,uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_hub_voucher_burn_submitted(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_hub_voucher_burn(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_hub_voucher_burn(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_hub_voucher_reconciliation(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prepare_hub_voucher_burn(uuid,uuid,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION mark_hub_voucher_burn_submitted(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_hub_voucher_burn(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_hub_voucher_burn(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_hub_voucher_reconciliation(uuid,uuid,text) TO service_role;

-- ── Safe expiry: unsigned reservations only ───────────────────────────────────
CREATE OR REPLACE FUNCTION expire_unsubmitted_spend_intents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent record;
  v_count integer := 0;
BEGIN
  FOR v_intent IN
    SELECT msi.id, msi.voucher_id, msi.burn_job_id
    FROM miles_spend_intents msi
    LEFT JOIN minipoint_burn_jobs j ON j.id = msi.burn_job_id
    WHERE msi.state = 'reserved'
      AND msi.reservation_expires_at < now()
      AND msi.submitted_tx_hash IS NULL
      AND (j.id IS NULL OR (
        j.status = 'pending'
        AND j.tx_hash IS NULL
        AND j.raw_signed_tx IS NULL
      ))
    FOR UPDATE OF msi SKIP LOCKED
  LOOP
    IF v_intent.burn_job_id IS NOT NULL THEN
      UPDATE minipoint_burn_jobs
      SET status = 'failed',
          last_error = 'reservation expired before transaction preparation'
      WHERE id = v_intent.burn_job_id
        AND status = 'pending'
        AND tx_hash IS NULL
        AND raw_signed_tx IS NULL;
    END IF;

    UPDATE miles_ledger_holds
    SET status = 'released'
    WHERE intent_id = v_intent.id AND status = 'active';

    UPDATE issued_vouchers
    SET status = 'void'
    WHERE id = v_intent.voucher_id AND status = 'pending';

    UPDATE miles_spend_intents
    SET state = 'failed',
        failed_at = now(),
        failure_code = 'RESERVATION_EXPIRED',
        failure_reason = 'Reservation expired before an on-chain transaction was signed'
    WHERE id = v_intent.id;

    IF NOT EXISTS (
      SELECT 1 FROM voucher_events
      WHERE issued_voucher_id = v_intent.voucher_id
        AND event_type = 'voided'
        AND metadata->>'intent_id' = v_intent.id::text
    ) THEN
      INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
      VALUES (
        v_intent.voucher_id, 'voided', 'spend_intent_sweeper',
        jsonb_build_object('intent_id', v_intent.id, 'reason', 'reservation_expired')
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  DELETE FROM voucher_purchase_quotes
  WHERE consumed = false AND expires_at < now() - interval '24 hours';

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION expire_unsubmitted_spend_intents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_unsubmitted_spend_intents() TO service_role;

-- ── Historical burn_ambiguous backlog inspection and controlled cleanup ──────
CREATE OR REPLACE VIEW hub_voucher_backlog_reconciliation AS
SELECT
  iv.id AS voucher_id,
  iv.hub_user_id,
  iv.voucher_template_id AS template_id,
  iv.created_at,
  iv.recovery_state,
  iv.burn_tx_hash,
  iv.burn_ref,
  EXISTS (
    SELECT 1 FROM miles_ledger ml
    WHERE ml.source_id = iv.id
      AND ml.direction = 'debit'
      AND ml.on_chain = false
      AND ml.note IN ('hub_voucher_purchase','hub_voucher_purchase_reversal')
  ) AS has_ledger_evidence,
  EXISTS (
    SELECT 1 FROM minipoint_burn_jobs j
    WHERE j.payload->>'voucher_id' = iv.id::text
  ) AS has_burn_job,
  EXISTS (
    SELECT 1 FROM idempotency_keys ik
    WHERE ik.key = iv.burn_idempotency_key
  ) AS has_platform_idempotency_evidence,
  CASE
    WHEN iv.burn_tx_hash IS NOT NULL OR iv.burn_ref IS NOT NULL THEN 'manual_chain_verification'
    WHEN EXISTS (
      SELECT 1 FROM miles_ledger ml
      WHERE ml.source_id = iv.id AND ml.direction = 'debit'
    ) THEN 'manual_ledger_verification'
    WHEN EXISTS (
      SELECT 1 FROM minipoint_burn_jobs j
      WHERE j.payload->>'voucher_id' = iv.id::text
    ) THEN 'manual_job_verification'
    WHEN EXISTS (
      SELECT 1 FROM idempotency_keys ik
      WHERE ik.key = iv.burn_idempotency_key
    ) THEN 'manual_idempotency_verification'
    ELSE 'safe_to_void'
  END AS recommendation
FROM issued_vouchers iv
WHERE iv.status = 'pending'
  AND iv.recovery_state = 'burn_ambiguous';

CREATE OR REPLACE FUNCTION void_unfunded_hub_voucher_backlog(
  p_voucher_ids uuid[],
  p_actor text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOREACH v_id IN ARRAY COALESCE(p_voucher_ids, '{}'::uuid[]) LOOP
    PERFORM 1
    FROM hub_voucher_backlog_reconciliation
    WHERE voucher_id = v_id AND recommendation = 'safe_to_void';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    PERFORM 1 FROM issued_vouchers WHERE id = v_id FOR UPDATE;
    UPDATE issued_vouchers
    SET status = 'void', recovery_state = NULL
    WHERE id = v_id AND status = 'pending';

    IF FOUND THEN
      INSERT INTO voucher_events(issued_voucher_id, event_type, actor_id, metadata)
      VALUES (
        v_id, 'reconciled', COALESCE(NULLIF(p_actor, ''), 'voucher_backlog_reconciliation'),
        jsonb_build_object('action', 'voided', 'reason', 'no_funding_evidence')
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION void_unfunded_hub_voucher_backlog(uuid[],text) FROM PUBLIC;
GRANT SELECT ON hub_voucher_backlog_reconciliation TO service_role;
GRANT EXECUTE ON FUNCTION void_unfunded_hub_voucher_backlog(uuid[],text) TO service_role;
