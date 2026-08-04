-- 054_canonical_partner_quest_completion.sql
-- Shared completion authority for the merchant quests exposed by
-- api_partner_quests and React's partner_quests catalog.
--
-- api_partner_quests is owned by the Akiba API, so this migration stores and
-- validates its IDs without taking a cross-service FK. All mutations remain
-- service-role-only and are idempotent at (canonical, quest, scope).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quest_catalog_bindings (
  quest_key               text        PRIMARY KEY,
  api_partner_quest_id    uuid        NOT NULL UNIQUE,
  react_partner_quest_id  uuid        NOT NULL UNIQUE,
  frequency               text        NOT NULL CHECK (frequency IN ('once', 'weekly')),
  base_points             integer     NOT NULL CHECK (base_points > 0),
  active                  boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO quest_catalog_bindings (
  quest_key, api_partner_quest_id, react_partner_quest_id, frequency, base_points
) VALUES
  ('pass_activated',
   '216cd2c5-74c9-4e79-80ba-612ecaff4aaf',
   'f647e695-7009-455a-a138-b3ee50de73f2', 'once', 20),
  ('deal_viewed',
   '83f26878-c33a-4c40-b0d0-6f7bfdf33355',
   '4eaf67c7-03f5-4c24-a63d-2c1c8ab765d1', 'once', 5),
  ('sponsored_game_played',
   '7161b80b-ba30-404e-aba3-3faa24f763c7',
   'c94ded62-19e8-4d04-910b-56e0dd1bec34', 'weekly', 25),
  ('profile_country_set',
   'a2a2cce0-6607-4648-a7fc-698d0ee5a489',
   '47bc3625-f2f6-4b0f-ae72-b8bfde85bd31', 'once', 50),
  ('voucher_redeemed',
   '2d3b9bb5-e3f2-49cf-8ca9-7369a2e03ff0',
   '2ad4bc13-d3b9-41b6-b3ef-d3a1ebb7b2aa', 'once', 100)
ON CONFLICT (quest_key) DO UPDATE SET
  api_partner_quest_id   = EXCLUDED.api_partner_quest_id,
  react_partner_quest_id = EXCLUDED.react_partner_quest_id,
  frequency              = EXCLUDED.frequency,
  base_points            = EXCLUDED.base_points,
  updated_at             = now();

CREATE TABLE IF NOT EXISTS hub_user_canonicals (
  hub_user_id   uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_id uuid        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_partner_quest_completions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id          uuid        NOT NULL,
  api_partner_quest_id  uuid        NOT NULL,
  quest_key             text        NOT NULL REFERENCES quest_catalog_bindings(quest_key),
  scope_key             text        NOT NULL,
  verification_source   text        NOT NULL,
  proof_ref             text        NOT NULL,
  claimed_from          text        NOT NULL CHECK (claimed_from IN ('react-app', 'hub-page', 'backfill')),
  verified_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_id, api_partner_quest_id, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_api_partner_quest_completions_canonical
  ON api_partner_quest_completions (canonical_id, scope_key);

CREATE TABLE IF NOT EXISTS api_partner_quest_reward_deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id       uuid        NOT NULL UNIQUE
                        REFERENCES api_partner_quest_completions(id) ON DELETE CASCADE,
  mode                text        NOT NULL CHECK (mode IN ('onchain_mint', 'offchain_ledger')),
  status              text        NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  base_points         integer     NOT NULL CHECK (base_points > 0),
  awarded_points      integer     NOT NULL CHECK (awarded_points > 0),
  destination_wallet  text,
  idempotency_key     text        NOT NULL UNIQUE,
  external_ref        text,
  ledger_entry_id     uuid,
  attempts            integer     NOT NULL DEFAULT 0,
  last_error          text,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'onchain_mint' AND destination_wallet IS NOT NULL) OR
    (mode = 'offchain_ledger' AND destination_wallet IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_api_partner_quest_deliveries_status
  ON api_partner_quest_reward_deliveries (status, updated_at);

CREATE TABLE IF NOT EXISTS partner_quest_identity_merge_audit (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  surviving_canonical   uuid        NOT NULL,
  merged_canonical      uuid        NOT NULL,
  conflict_kind         text        NOT NULL,
  kept_completion_id    uuid,
  removed_snapshot      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quest_catalog_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_user_canonicals ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_partner_quest_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_partner_quest_reward_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_quest_identity_merge_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON quest_catalog_bindings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hub_user_canonicals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON api_partner_quest_completions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON api_partner_quest_reward_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON partner_quest_identity_merge_audit FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON quest_catalog_bindings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON hub_user_canonicals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_partner_quest_completions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_partner_quest_reward_deliveries TO service_role;
GRANT SELECT, INSERT ON partner_quest_identity_merge_audit TO service_role;

-- Attach the canonical delivery directly to new React mint jobs. This is
-- conditional because the root Hub migration suite can be applied before the
-- React-owned queue schema in disposable environments.
DO $$
BEGIN
  IF to_regclass('public.minipoint_mint_jobs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE minipoint_mint_jobs ADD COLUMN IF NOT EXISTS api_partner_quest_delivery_id uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_minipoint_jobs_partner_delivery ON minipoint_mint_jobs (api_partner_quest_delivery_id) WHERE api_partner_quest_delivery_id IS NOT NULL';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_partner_quest_canonical(
  p_hub_user_id uuid DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_wallet      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email            text := NULLIF(lower(btrim(p_email)), '');
  v_wallet           text := NULLIF(lower(btrim(p_wallet)), '');
  v_hub_canonical    uuid;
  v_email_canonical  uuid;
  v_wallet_canonical uuid;
  v_canonical        uuid;
BEGIN
  IF p_hub_user_id IS NULL AND v_email IS NULL AND v_wallet IS NULL THEN
    RAISE EXCEPTION 'partner quest participant identity is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    COALESCE(p_hub_user_id::text, '') || '|' || COALESCE(v_email, '') || '|' || COALESCE(v_wallet, ''), 0
  ));

  IF p_hub_user_id IS NOT NULL THEN
    SELECT canonical_id INTO v_hub_canonical
    FROM hub_user_canonicals WHERE hub_user_id = p_hub_user_id FOR UPDATE;
  END IF;
  IF v_email IS NOT NULL THEN
    SELECT canonical_id INTO v_email_canonical
    FROM identity_links
    WHERE identity_type = 'email' AND identity_value = v_email
    FOR UPDATE;
  END IF;
  IF v_wallet IS NOT NULL THEN
    SELECT canonical_id INTO v_wallet_canonical
    FROM identity_links
    WHERE identity_type = 'wallet' AND identity_value = v_wallet
    FOR UPDATE;
  END IF;

  IF (v_hub_canonical IS NOT NULL AND v_email_canonical IS NOT NULL AND v_hub_canonical <> v_email_canonical)
     OR (v_hub_canonical IS NOT NULL AND v_wallet_canonical IS NOT NULL AND v_hub_canonical <> v_wallet_canonical)
     OR (v_email_canonical IS NOT NULL AND v_wallet_canonical IS NOT NULL AND v_email_canonical <> v_wallet_canonical)
  THEN
    RAISE EXCEPTION 'partner quest identities require a verified canonical merge'
      USING ERRCODE = 'P0001';
  END IF;

  v_canonical := COALESCE(v_hub_canonical, v_wallet_canonical, v_email_canonical, gen_random_uuid());

  IF p_hub_user_id IS NOT NULL THEN
    INSERT INTO hub_user_canonicals (hub_user_id, canonical_id)
    VALUES (p_hub_user_id, v_canonical)
    ON CONFLICT (hub_user_id) DO NOTHING;
  END IF;

  IF v_email IS NOT NULL THEN
    INSERT INTO identity_links (canonical_id, identity_type, identity_value)
    VALUES (v_canonical, 'email', v_email)
    ON CONFLICT (identity_type, identity_value) DO NOTHING;
  END IF;

  IF v_wallet IS NOT NULL THEN
    INSERT INTO identity_links (canonical_id, identity_type, identity_value)
    VALUES (v_canonical, 'wallet', v_wallet)
    ON CONFLICT (identity_type, identity_value) DO NOTHING;
  END IF;

  RETURN v_canonical;
END;
$$;

REVOKE ALL ON FUNCTION resolve_partner_quest_canonical(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_partner_quest_canonical(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION merge_partner_quest_canonicals(
  p_surviving_canonical uuid,
  p_merged_canonical    uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              api_partner_quest_completions%ROWTYPE;
  v_existing_id      uuid;
  v_loser_delivery   api_partner_quest_reward_deliveries%ROWTYPE;
  v_kept_delivery    api_partner_quest_reward_deliveries%ROWTYPE;
  v_loser_rank       integer;
  v_kept_rank        integer;
BEGIN
  IF p_surviving_canonical = p_merged_canonical THEN
    RETURN p_surviving_canonical;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(p_surviving_canonical::text, p_merged_canonical::text), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(p_surviving_canonical::text, p_merged_canonical::text), 0));

  IF EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_surviving_canonical)
     AND EXISTS (SELECT 1 FROM hub_user_canonicals WHERE canonical_id = p_merged_canonical)
  THEN
    RAISE EXCEPTION 'cannot automatically merge two Hub accounts' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT * FROM api_partner_quest_completions
    WHERE canonical_id = p_merged_canonical
    FOR UPDATE
  LOOP
    SELECT id INTO v_existing_id
    FROM api_partner_quest_completions
    WHERE canonical_id = p_surviving_canonical
      AND api_partner_quest_id = v_row.api_partner_quest_id
      AND scope_key = v_row.scope_key
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      UPDATE api_partner_quest_completions
      SET canonical_id = p_surviving_canonical
      WHERE id = v_row.id;
    ELSE
      SELECT * INTO v_loser_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id FOR UPDATE;
      SELECT * INTO v_kept_delivery
      FROM api_partner_quest_reward_deliveries WHERE completion_id = v_existing_id FOR UPDATE;

      v_loser_rank := CASE v_loser_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;
      v_kept_rank := CASE v_kept_delivery.status
        WHEN 'completed' THEN 4 WHEN 'processing' THEN 3 WHEN 'pending' THEN 2 ELSE 1 END;

      INSERT INTO partner_quest_identity_merge_audit (
        surviving_canonical, merged_canonical, conflict_kind,
        kept_completion_id, removed_snapshot
      ) VALUES (
        p_surviving_canonical, p_merged_canonical, 'duplicate_quest_scope',
        v_existing_id, to_jsonb(v_row) || jsonb_build_object('delivery', to_jsonb(v_loser_delivery))
      );

      IF v_loser_rank > v_kept_rank THEN
        UPDATE api_partner_quest_reward_deliveries SET
          mode = v_loser_delivery.mode,
          status = v_loser_delivery.status,
          base_points = v_loser_delivery.base_points,
          awarded_points = v_loser_delivery.awarded_points,
          destination_wallet = v_loser_delivery.destination_wallet,
          external_ref = v_loser_delivery.external_ref,
          ledger_entry_id = v_loser_delivery.ledger_entry_id,
          attempts = v_loser_delivery.attempts,
          last_error = v_loser_delivery.last_error,
          completed_at = v_loser_delivery.completed_at,
          updated_at = now()
        WHERE completion_id = v_existing_id;
      END IF;

      DELETE FROM api_partner_quest_reward_deliveries WHERE completion_id = v_row.id;
      DELETE FROM api_partner_quest_completions WHERE id = v_row.id;
    END IF;
  END LOOP;

  UPDATE identity_links
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE miles_ledger
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  UPDATE hub_user_canonicals
  SET canonical_id = p_surviving_canonical
  WHERE canonical_id = p_merged_canonical;

  INSERT INTO partner_quest_identity_merge_audit (
    surviving_canonical, merged_canonical, conflict_kind
  ) VALUES (p_surviving_canonical, p_merged_canonical, 'canonical_merged');

  RETURN p_surviving_canonical;
END;
$$;

REVOKE ALL ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_partner_quest_canonicals(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION link_partner_quest_wallet_identity(
  p_hub_user_id uuid,
  p_email       text,
  p_wallet      text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_canonical    uuid;
  v_wallet_canonical uuid;
  v_email_canonical  uuid;
  v_email            text := NULLIF(lower(btrim(p_email)), '');
  v_wallet           text := NULLIF(lower(btrim(p_wallet)), '');
BEGIN
  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'verified wallet is required' USING ERRCODE = '22023';
  END IF;

  SELECT canonical_id INTO v_hub_canonical
  FROM hub_user_canonicals WHERE hub_user_id = p_hub_user_id FOR UPDATE;
  IF v_hub_canonical IS NULL THEN
    v_hub_canonical := resolve_partner_quest_canonical(p_hub_user_id, v_email, NULL);
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT canonical_id INTO v_email_canonical
    FROM identity_links
    WHERE identity_type = 'email' AND identity_value = v_email
    FOR UPDATE;
    IF v_email_canonical IS NOT NULL AND v_email_canonical <> v_hub_canonical THEN
      PERFORM merge_partner_quest_canonicals(v_hub_canonical, v_email_canonical);
    END IF;
  END IF;

  SELECT canonical_id INTO v_wallet_canonical
  FROM identity_links
  WHERE identity_type = 'wallet' AND identity_value = v_wallet
  FOR UPDATE;

  IF v_wallet_canonical IS NOT NULL AND v_wallet_canonical <> v_hub_canonical THEN
    PERFORM merge_partner_quest_canonicals(v_hub_canonical, v_wallet_canonical);
  END IF;

  INSERT INTO identity_links (canonical_id, identity_type, identity_value)
  VALUES (v_hub_canonical, 'wallet', v_wallet)
  ON CONFLICT (identity_type, identity_value) DO UPDATE
    SET canonical_id = EXCLUDED.canonical_id;

  IF v_email IS NOT NULL THEN
    INSERT INTO identity_links (canonical_id, identity_type, identity_value)
    VALUES (v_hub_canonical, 'email', v_email)
    ON CONFLICT (identity_type, identity_value) DO NOTHING;
  END IF;

  RETURN v_hub_canonical;
END;
$$;

REVOKE ALL ON FUNCTION link_partner_quest_wallet_identity(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION link_partner_quest_wallet_identity(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION reserve_api_partner_quest_claim(
  p_canonical_id        uuid,
  p_quest_key           text,
  p_scope_key           text,
  p_verification_source text,
  p_proof_ref           text,
  p_claimed_from        text,
  p_delivery_mode       text,
  p_destination_wallet  text DEFAULT NULL,
  p_awarded_points      integer DEFAULT NULL
) RETURNS TABLE(
  completion_id uuid,
  delivery_id uuid,
  delivery_status text,
  delivery_mode text,
  awarded_points integer,
  external_ref text,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_binding      quest_catalog_bindings%ROWTYPE;
  v_completion   api_partner_quest_completions%ROWTYPE;
  v_delivery     api_partner_quest_reward_deliveries%ROWTYPE;
  v_created      boolean := false;
  v_ledger_id    uuid;
  v_points       integer;
BEGIN
  SELECT * INTO v_binding
  FROM quest_catalog_bindings
  WHERE quest_key = p_quest_key AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown or inactive partner quest %', p_quest_key USING ERRCODE = '22023';
  END IF;

  IF v_binding.frequency = 'once' AND p_scope_key <> 'lifetime' THEN
    RAISE EXCEPTION 'one-time quest scope must be lifetime' USING ERRCODE = '22023';
  END IF;
  IF v_binding.frequency = 'weekly' AND p_scope_key !~ '^[0-9]{4}-W[0-9]{2}$' THEN
    RAISE EXCEPTION 'weekly quest scope is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_mode NOT IN ('onchain_mint', 'offchain_ledger') THEN
    RAISE EXCEPTION 'invalid partner quest delivery mode' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_mode = 'onchain_mint' AND NULLIF(lower(btrim(p_destination_wallet)), '') IS NULL THEN
    RAISE EXCEPTION 'on-chain delivery requires a wallet' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_canonical_id::text || '|' || v_binding.api_partner_quest_id::text || '|' || p_scope_key, 0
  ));

  SELECT * INTO v_completion
  FROM api_partner_quest_completions
  WHERE canonical_id = p_canonical_id
    AND api_partner_quest_id = v_binding.api_partner_quest_id
    AND scope_key = p_scope_key
  FOR UPDATE;

  IF v_completion.id IS NULL THEN
    INSERT INTO api_partner_quest_completions (
      canonical_id, api_partner_quest_id, quest_key, scope_key,
      verification_source, proof_ref, claimed_from
    ) VALUES (
      p_canonical_id, v_binding.api_partner_quest_id, v_binding.quest_key, p_scope_key,
      p_verification_source, p_proof_ref, p_claimed_from
    ) RETURNING * INTO v_completion;
    v_created := true;
  END IF;

  SELECT delivery.* INTO v_delivery
  FROM api_partner_quest_reward_deliveries AS delivery
  WHERE delivery.completion_id = v_completion.id
  FOR UPDATE;

  IF v_delivery.id IS NULL THEN
    v_points := CASE
      WHEN p_delivery_mode = 'offchain_ledger' THEN v_binding.base_points
      ELSE COALESCE(NULLIF(p_awarded_points, 0), v_binding.base_points)
    END;

    INSERT INTO api_partner_quest_reward_deliveries (
      completion_id, mode, status, base_points, awarded_points,
      destination_wallet, idempotency_key
    ) VALUES (
      v_completion.id,
      p_delivery_mode,
      CASE WHEN p_delivery_mode = 'offchain_ledger' THEN 'processing' ELSE 'pending' END,
      v_binding.base_points,
      v_points,
      CASE WHEN p_delivery_mode = 'onchain_mint' THEN lower(btrim(p_destination_wallet)) ELSE NULL END,
      'partner-quest:' || p_canonical_id::text || ':' || v_binding.quest_key || ':' || p_scope_key
    ) RETURNING * INTO v_delivery;

    IF p_delivery_mode = 'offchain_ledger' THEN
      INSERT INTO miles_ledger (
        canonical_id, amount, direction, source_type, source_id, on_chain, note
      ) VALUES (
        p_canonical_id, v_points, 'credit', 'quest', v_completion.id, false,
        'Partner quest: ' || v_binding.quest_key || ' (' || p_scope_key || ')'
      ) RETURNING id INTO v_ledger_id;

      UPDATE api_partner_quest_reward_deliveries SET
        status = 'completed',
        ledger_entry_id = v_ledger_id,
        external_ref = v_ledger_id::text,
        completed_at = now(),
        updated_at = now()
      WHERE id = v_delivery.id
      RETURNING * INTO v_delivery;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_completion.id, v_delivery.id, v_delivery.status, v_delivery.mode,
    v_delivery.awarded_points, v_delivery.external_ref, v_created;
END;
$$;

REVOKE ALL ON FUNCTION reserve_api_partner_quest_claim(uuid, text, text, text, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_api_partner_quest_claim(uuid, text, text, text, text, text, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION complete_api_partner_quest_delivery(
  p_delivery_id uuid,
  p_external_ref text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE api_partner_quest_reward_deliveries SET
    status = 'completed',
    external_ref = COALESCE(p_external_ref, external_ref),
    completed_at = COALESCE(completed_at, now()),
    last_error = NULL,
    updated_at = now()
  WHERE id = p_delivery_id AND status <> 'completed';
END;
$$;

CREATE OR REPLACE FUNCTION fail_api_partner_quest_delivery(
  p_delivery_id uuid,
  p_error text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE api_partner_quest_reward_deliveries SET
    status = 'failed',
    last_error = left(COALESCE(p_error, 'delivery failed'), 1000),
    attempts = attempts + 1,
    updated_at = now()
  WHERE id = p_delivery_id AND status <> 'completed';
END;
$$;

REVOKE ALL ON FUNCTION complete_api_partner_quest_delivery(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_api_partner_quest_delivery(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_api_partner_quest_delivery(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION fail_api_partner_quest_delivery(uuid, text) TO service_role;

-- Backfill only legacy claims that have a confirmed completed mint job. The
-- block is safe when React's tables have not been installed in this database.
DO $$
DECLARE
  v_row record;
  v_canonical uuid;
  v_reserved record;
BEGIN
  -- Existing cryptographically verified Hub wallets predate this canonical
  -- registry. Attach and merge them before importing wallet-keyed completions.
  IF to_regclass('public.hub_user_wallets') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'hub_user_wallets'
         AND column_name = 'verification_status'
     ) THEN
    FOR v_row IN EXECUTE $sql$
      SELECT huw.user_id AS hub_user_id, au.email, lower(huw.address) AS wallet
      FROM hub_user_wallets huw
      JOIN auth.users au ON au.id = huw.user_id
      WHERE huw.verification_status = 'verified'
      ORDER BY huw.linked_at
    $sql$
    LOOP
      PERFORM link_partner_quest_wallet_identity(v_row.hub_user_id, v_row.email, v_row.wallet);
    END LOOP;
  END IF;

  IF to_regclass('public.partner_engagements') IS NOT NULL
     AND to_regclass('public.minipoint_mint_jobs') IS NOT NULL THEN
    FOR v_row IN EXECUTE $sql$
      SELECT pe.id, lower(pe.user_address) AS wallet, pe.partner_quest_id,
             pe.points_awarded, pe.claimed_at, j.tx_hash, b.quest_key
      FROM partner_engagements pe
      JOIN quest_catalog_bindings b ON b.react_partner_quest_id = pe.partner_quest_id
      JOIN minipoint_mint_jobs j
        ON j.idempotency_key = 'partner:' || pe.partner_quest_id::text || ':' || lower(pe.user_address)
       AND j.status = 'completed'
    $sql$
    LOOP
      v_canonical := resolve_partner_quest_canonical(NULL, NULL, v_row.wallet);
      SELECT * INTO v_reserved FROM reserve_api_partner_quest_claim(
        v_canonical, v_row.quest_key, 'lifetime', 'legacy_partner_engagement',
        'partner_engagement:' || v_row.id::text, 'backfill', 'onchain_mint',
        v_row.wallet, v_row.points_awarded
      );
      PERFORM complete_api_partner_quest_delivery(v_reserved.delivery_id, v_row.tx_hash);
    END LOOP;
  END IF;

  IF to_regclass('public.partner_quest_weekly_claims') IS NOT NULL
     AND to_regclass('public.minipoint_mint_jobs') IS NOT NULL THEN
    FOR v_row IN EXECUTE $sql$
      SELECT pqwc.wallet, pqwc.partner_quest_id, pqwc.iso_week,
             pqwc.points_awarded, pqwc.claimed_at, COALESCE(pqwc.tx_hash, j.tx_hash) AS tx_hash,
             b.quest_key
      FROM (
        SELECT lower(user_address) AS wallet, partner_quest_id, iso_week,
               points_awarded, claimed_at, tx_hash
        FROM partner_quest_weekly_claims
      ) pqwc
      JOIN quest_catalog_bindings b ON b.react_partner_quest_id = pqwc.partner_quest_id
      JOIN minipoint_mint_jobs j
        ON j.idempotency_key = 'partner-weekly:' || pqwc.partner_quest_id::text || ':' || pqwc.wallet || ':' || pqwc.iso_week
       AND j.status = 'completed'
    $sql$
    LOOP
      v_canonical := resolve_partner_quest_canonical(NULL, NULL, v_row.wallet);
      SELECT * INTO v_reserved FROM reserve_api_partner_quest_claim(
        v_canonical, v_row.quest_key, v_row.iso_week, 'legacy_partner_weekly_claim',
        'partner_weekly:' || v_row.partner_quest_id::text || ':' || v_row.wallet || ':' || v_row.iso_week,
        'backfill', 'onchain_mint', v_row.wallet, v_row.points_awarded
      );
      PERFORM complete_api_partner_quest_delivery(v_reserved.delivery_id, v_row.tx_hash);
    END LOOP;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
