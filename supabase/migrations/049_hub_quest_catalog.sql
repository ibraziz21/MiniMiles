-- 049_hub_quest_catalog.sql
-- Merchant/shopping quests, Slice 3 (merchant-shopping-quests-spec.md §5) —
-- missing proof producers for the account-first Hub quest catalog.
--
-- Adds the two Hub-owned domain records the new quest verifiers need
-- (hub_user_profiles.country, hub_quest_action_proofs for deal_viewed), plus
-- RPCs that atomically write the domain row and enqueue the matching durable
-- internal_event_jobs row — same shape as create_or_get_hub_pass
-- (044_internal_event_outbox.sql) and reemitPassActivated's identity-replay
-- pattern. Also backfills pass_activated/voucher_redeemed events for rows
-- that predate the outbox, so existing users qualify retroactively without
-- duplicating completions (idempotency_key uniqueness makes every backfill
-- insert here safe to re-run).

-- ── hub_user_profiles ────────────────────────────────────────────────────────
-- Hub-native country field so email-only members can complete "Tell us where
-- you shop" without a wallet-keyed `users` row. Legacy `users.country` may
-- prefill the /me editor, but this table is the quest verifier of record.

CREATE TABLE IF NOT EXISTS hub_user_profiles (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  country     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_user_profiles_select_own"
  ON hub_user_profiles FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON hub_user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hub_user_profiles TO authenticated;
GRANT ALL ON hub_user_profiles TO service_role;

-- ── hub_quest_action_proofs ──────────────────────────────────────────────────
-- Server-recorded proof for low-friction quests with no existing domain
-- table to verify against (launch use: deal_viewed only, spec §5 "Deal view").

CREATE TABLE IF NOT EXISTS hub_quest_action_proofs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_key     text        NOT NULL,
  action_ref    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (hub_user_id, quest_key, action_ref)
);

CREATE INDEX IF NOT EXISTS idx_hqap_user_quest
  ON hub_quest_action_proofs (hub_user_id, quest_key);

ALTER TABLE hub_quest_action_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_quest_action_proofs_select_own"
  ON hub_quest_action_proofs FOR SELECT
  USING (auth.uid() = hub_user_id);

REVOKE ALL ON hub_quest_action_proofs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hub_quest_action_proofs TO authenticated;
GRANT ALL ON hub_quest_action_proofs TO service_role;

-- ── set_hub_profile_country ──────────────────────────────────────────────────
-- Upserts hub_user_profiles.country. Only on a transition from no valid
-- country to a valid one does it enqueue profile_country_set — repeat calls
-- with the same or another valid country never re-fire the event (spec §10
-- "Country transition emits once and invalid input emits nothing").

CREATE OR REPLACE FUNCTION set_hub_profile_country(
  p_user_id    uuid,
  p_identities jsonb,
  p_country    text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev_country text;
BEGIN
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RETURN;
  END IF;

  SELECT country INTO v_prev_country FROM hub_user_profiles WHERE user_id = p_user_id;

  INSERT INTO hub_user_profiles (user_id, country, updated_at)
  VALUES (p_user_id, p_country, now())
  ON CONFLICT (user_id) DO UPDATE
    SET country = EXCLUDED.country, updated_at = now();

  IF v_prev_country IS NULL OR btrim(v_prev_country) = '' THEN
    INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
    VALUES (
      'profile_country_set',
      'profile_country:' || p_user_id::text,
      COALESCE(p_identities, '[]'::jsonb),
      jsonb_build_object('userId', p_user_id, 'country', p_country)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION set_hub_profile_country(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_hub_profile_country(uuid, jsonb, text)
  TO service_role;

-- ── record_hub_deal_view ─────────────────────────────────────────────────────
-- Records a server-validated deal view (caller must have already checked the
-- offer against list_available_voucher_template_ids_hub before calling this)
-- and enqueues deal_viewed exactly once per (user, offer) — repeat views of
-- the same offer are no-ops (spec §5 "Deal view", §10 dedupe requirement).

CREATE OR REPLACE FUNCTION record_hub_deal_view(
  p_hub_user_id uuid,
  p_offer_id    uuid,
  p_identities  jsonb,
  p_metadata    jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted uuid;
BEGIN
  INSERT INTO hub_quest_action_proofs (hub_user_id, quest_key, action_ref)
  VALUES (p_hub_user_id, 'deal_viewed', p_offer_id)
  ON CONFLICT (hub_user_id, quest_key, action_ref) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
  VALUES (
    'deal_viewed',
    'deal-viewed:' || p_hub_user_id::text || ':' || p_offer_id::text,
    COALESCE(p_identities, '[]'::jsonb),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION record_hub_deal_view(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_hub_deal_view(uuid, uuid, jsonb, jsonb)
  TO service_role;

-- ── Backfill: pass_activated for pre-outbox pass rows ────────────────────────
-- create_or_get_hub_pass (044) only enqueues pass_activated for rows it
-- creates; hub_user_passes rows written before 044 shipped never got one.
-- ON CONFLICT DO NOTHING makes this safe to re-run and a no-op for anyone
-- already covered.

INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
SELECT
  'pass_activated',
  'pass:' || hup.user_id::text,
  jsonb_build_array(jsonb_build_object('type', 'email', 'value', hup.email)),
  jsonb_build_object('userId', hup.user_id, 'backfilled', true)
FROM hub_user_passes hup
ON CONFLICT (idempotency_key) DO NOTHING;

-- ── Backfill: voucher_redeemed for pre-outbox redeemed vouchers ──────────────
-- Existing historical redeemed vouchers qualify retroactively (spec §5
-- "Voucher redemption"). Ownership by hub_user_id first, wallet second,
-- matching the existing place_hub_order_and_redeem_voucher ownership check.

INSERT INTO internal_event_jobs (event_type, idempotency_key, identities, metadata)
SELECT
  'voucher_redeemed',
  'vredeem:' || iv.id::text,
  CASE
    WHEN iv.hub_user_id IS NOT NULL THEN
      jsonb_build_array(jsonb_build_object('type', 'email', 'value', au.email))
    ELSE
      jsonb_build_array(jsonb_build_object('type', 'wallet', 'value', lower(iv.user_address)))
  END,
  jsonb_build_object('voucherId', iv.id, 'merchantId', iv.merchant_id, 'backfilled', true)
FROM issued_vouchers iv
LEFT JOIN auth.users au ON au.id = iv.hub_user_id
WHERE iv.status = 'redeemed'
  AND (iv.hub_user_id IS NOT NULL OR iv.user_address IS NOT NULL)
ON CONFLICT (idempotency_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
