-- Close the identity gap between Supabase Auth, Akiba Platform purchase
-- identities and Hub's canonical Miles identity.
--
-- Before this migration, resolve_partner_quest_canonical only consulted the
-- global identity_links table. The purchase pipeline records its authoritative
-- email evidence in purchase_event_identities, so an event-time signup could
-- receive Miles under one canonical id while Hub later generated a second id
-- for the same verified email. An auth user was therefore not sufficient to
-- prove ownership of the Miles they had just earned.

CREATE TABLE IF NOT EXISTS hub_identity_reconciliation_failures (
  -- Deliberately not a foreign key: an unresolved identity incident must not
  -- be able to block Auth deletion. Account-deletion policy inventories this
  -- restricted audit row with the other identity/fraud evidence instead.
  hub_user_id uuid PRIMARY KEY,
  email text,
  error_code text NOT NULL,
  error_detail text,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE hub_identity_reconciliation_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hub_identity_reconciliation_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON hub_identity_reconciliation_failures TO service_role;

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
  v_email                 text := NULLIF(lower(btrim(p_email)), '');
  v_wallet                text := NULLIF(lower(btrim(p_wallet)), '');
  v_hub_canonical         uuid;
  v_email_canonical       uuid;
  v_wallet_canonical      uuid;
  v_purchase_canonical    uuid;
  v_purchase_count        integer := 0;
  v_canonical             uuid;
  v_other_hub_user        uuid;
BEGIN
  IF p_hub_user_id IS NULL AND v_email IS NULL AND v_wallet IS NULL THEN
    RAISE EXCEPTION 'partner quest participant identity is required' USING ERRCODE = '22023';
  END IF;

  -- Every path resolving the same verified email/wallet serializes here. This
  -- keeps the preflight conflict checks and inserts one atomic decision.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    COALESCE(v_email, '') || '|' || COALESCE(v_wallet, '') || '|' || COALESCE(p_hub_user_id::text, ''),
    0
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

    -- purchase_event_identities is Akiba-Platform-owned and may not exist in
    -- stripped-down local schemas. In production it is the authoritative
    -- event-time identity snapshot. Never guess when one email has somehow
    -- been assigned to multiple purchase canonicals: that requires an
    -- explicit audited merge.
    IF to_regclass('public.purchase_event_identities') IS NOT NULL THEN
      EXECUTE $query$
        SELECT count(*), min(canonical_id::text)::uuid
        FROM (
          SELECT DISTINCT canonical_id
          FROM purchase_event_identities
          WHERE identity_type = 'email' AND lower(btrim(identity_value)) = $1
        ) purchase_canonicals
      $query$
      INTO v_purchase_count, v_purchase_canonical
      USING v_email;

      IF v_purchase_count > 1 THEN
        RAISE EXCEPTION 'verified email is associated with multiple purchase identities'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF v_wallet IS NOT NULL THEN
    SELECT canonical_id INTO v_wallet_canonical
    FROM identity_links
    WHERE identity_type = 'wallet' AND identity_value = v_wallet
    FOR UPDATE;
  END IF;

  IF (v_hub_canonical IS NOT NULL AND v_email_canonical IS NOT NULL AND v_hub_canonical <> v_email_canonical)
     OR (v_hub_canonical IS NOT NULL AND v_wallet_canonical IS NOT NULL AND v_hub_canonical <> v_wallet_canonical)
     OR (v_hub_canonical IS NOT NULL AND v_purchase_canonical IS NOT NULL AND v_hub_canonical <> v_purchase_canonical)
     OR (v_email_canonical IS NOT NULL AND v_wallet_canonical IS NOT NULL AND v_email_canonical <> v_wallet_canonical)
     OR (v_email_canonical IS NOT NULL AND v_purchase_canonical IS NOT NULL AND v_email_canonical <> v_purchase_canonical)
     OR (v_wallet_canonical IS NOT NULL AND v_purchase_canonical IS NOT NULL AND v_wallet_canonical <> v_purchase_canonical)
  THEN
    RAISE EXCEPTION 'participant identities require a verified canonical merge'
      USING ERRCODE = 'P0001';
  END IF;

  v_canonical := COALESCE(
    v_hub_canonical,
    v_email_canonical,
    v_wallet_canonical,
    v_purchase_canonical,
    gen_random_uuid()
  );

  IF p_hub_user_id IS NOT NULL THEN
    SELECT hub_user_id INTO v_other_hub_user
    FROM hub_user_canonicals
    WHERE canonical_id = v_canonical AND hub_user_id <> p_hub_user_id
    FOR UPDATE;
    IF v_other_hub_user IS NOT NULL THEN
      RAISE EXCEPTION 'canonical identity is already owned by another Hub account'
        USING ERRCODE = 'P0001';
    END IF;

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

-- Auth is the identity root. Establish the Hub/canonical bridge as soon as a
-- verified-email account is created instead of waiting for an unrelated Hub
-- profile, quest or settings page to be opened later.
CREATE OR REPLACE FUNCTION ensure_auth_user_canonical_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM resolve_partner_quest_canonical(NEW.id, NEW.email, NULL);
    UPDATE hub_identity_reconciliation_failures
    SET resolved_at = now(), last_failed_at = now()
    WHERE hub_user_id = NEW.id AND resolved_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO hub_identity_reconciliation_failures (
      hub_user_id, email, error_code, error_detail
    ) VALUES (
      NEW.id, lower(btrim(NEW.email)), SQLSTATE, left(SQLERRM, 500)
    )
    ON CONFLICT (hub_user_id) DO UPDATE SET
      email = EXCLUDED.email,
      error_code = EXCLUDED.error_code,
      error_detail = EXCLUDED.error_detail,
      attempts = hub_identity_reconciliation_failures.attempts + 1,
      last_failed_at = now(),
      resolved_at = NULL;
  END;

  -- Identity enrichment must never roll back a successful authentication.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_canonical_identity ON auth.users;
CREATE TRIGGER trg_auth_user_canonical_identity
AFTER INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION ensure_auth_user_canonical_identity();

-- Reconcile existing Auth accounts. Conflicts are recorded for review rather
-- than guessed or allowed to abort the migration.
DO $$
DECLARE
  v_user record;
BEGIN
  FOR v_user IN
    SELECT id, email FROM auth.users WHERE email IS NOT NULL AND btrim(email) <> ''
  LOOP
    BEGIN
      PERFORM resolve_partner_quest_canonical(v_user.id, v_user.email, NULL);
      UPDATE hub_identity_reconciliation_failures
      SET resolved_at = now(), last_failed_at = now()
      WHERE hub_user_id = v_user.id AND resolved_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO hub_identity_reconciliation_failures (
        hub_user_id, email, error_code, error_detail
      ) VALUES (
        v_user.id, lower(btrim(v_user.email)), SQLSTATE, left(SQLERRM, 500)
      )
      ON CONFLICT (hub_user_id) DO UPDATE SET
        email = EXCLUDED.email,
        error_code = EXCLUDED.error_code,
        error_detail = EXCLUDED.error_detail,
        attempts = hub_identity_reconciliation_failures.attempts + 1,
        last_failed_at = now(),
        resolved_at = NULL;
    END;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_hub_identity_reconciliation_failures_open
  ON hub_identity_reconciliation_failures (last_failed_at)
  WHERE resolved_at IS NULL;

DO $$
BEGIN
  IF to_regclass('public.purchase_event_identities') IS NOT NULL THEN
    EXECUTE $index$
      CREATE INDEX IF NOT EXISTS idx_purchase_event_identities_email_normalized
      ON purchase_event_identities (lower(btrim(identity_value)), canonical_id)
      WHERE identity_type = 'email'
    $index$;
  END IF;
END;
$$;
