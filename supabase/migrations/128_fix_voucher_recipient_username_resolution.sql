-- Qualify the lookup columns so they do not collide with the resolver's
-- RETURNS TABLE variables. Keep the existing RPC contract and grants.

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

  SELECT profile.* INTO v_profile
  FROM public.leaderboard_profiles AS profile
  WHERE profile.username_normalized = v_normalized;

  IF v_profile.canonical_id IS NULL THEN
    RETURN QUERY SELECT false, 'USERNAME_NOT_FOUND', NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT identity.hub_user_id INTO v_hub_user
  FROM public.hub_user_canonicals AS identity
  WHERE identity.canonical_id = v_profile.canonical_id;

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
