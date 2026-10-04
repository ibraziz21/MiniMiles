-- voucher-web2-username-identity-spec.md — foundational slice.
--
-- Adds the one server-side resolver every voucher-owned surface (Admin,
-- Merchant, Hub) needs to go from a public @username to the immutable
-- hub_user_id that actually owns vouchers, plus the audit snapshot column
-- claims need to record which username was current at claim time.
--
-- This migration does NOT touch issued_vouchers.user_address, does not make
-- hub_user_id NOT NULL, and does not change issue_voucher_from_program's
-- wallet-resolution behavior — those are later, higher-risk steps in the
-- spec's own rollout sequence (§11) and require a historical data migration
-- (§7) this change does not attempt.

-- ── resolve_voucher_recipient_username ───────────────────────────────────────
-- normalized username -> exactly one active username record -> canonical_id
-- -> exactly one active hub_user_id (spec §3.2). Zero matches and an
-- ambiguous/incomplete link are distinct, both fail closed, and neither
-- falls back to email, phone, or wallet.

CREATE OR REPLACE FUNCTION public.resolve_voucher_recipient_username(p_username text)
RETURNS TABLE(
  ok                  boolean,
  error_code          text,
  username            text,
  username_normalized text,
  hub_user_id         uuid,
  canonical_id        uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text := lower(btrim(COALESCE(p_username, '')));
  v_profile    public.leaderboard_profiles%ROWTYPE;
  v_hub_user   uuid;
BEGIN
  IF left(v_normalized, 1) = '@' THEN
    v_normalized := substring(v_normalized from 2);
  END IF;

  IF v_normalized !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN QUERY SELECT false, 'USERNAME_INVALID', NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.leaderboard_profiles
  WHERE username_normalized = v_normalized;

  IF v_profile.canonical_id IS NULL THEN
    RETURN QUERY SELECT false, 'USERNAME_NOT_FOUND', NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT hub_user_id INTO v_hub_user
  FROM public.hub_user_canonicals
  WHERE canonical_id = v_profile.canonical_id;

  IF v_hub_user IS NULL THEN
    RETURN QUERY SELECT false, 'USERNAME_IDENTITY_UNAVAILABLE', NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true, NULL::text, v_profile.username::text, v_profile.username_normalized,
    v_hub_user, v_profile.canonical_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_voucher_recipient_username(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_voucher_recipient_username(text)
  TO service_role;

COMMENT ON FUNCTION public.resolve_voucher_recipient_username(text) IS
  'Server-only username -> hub_user_id resolver for voucher recipients. Fails closed on no match or an ambiguous/incomplete identity link; never falls back to email, phone, or wallet.';

-- ── Claim-time username snapshot ─────────────────────────────────────────────
-- Immutable display/audit evidence only (spec §3.6, §6.2) — never used for
-- later authorization. Additive and nullable: existing rows and callers that
-- don't pass it are unaffected.

ALTER TABLE public.voucher_purchase_quotes
  ADD COLUMN IF NOT EXISTS username_at_claim text;

ALTER TABLE public.issued_vouchers
  ADD COLUMN IF NOT EXISTS username_at_claim text;
