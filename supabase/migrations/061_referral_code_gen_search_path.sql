-- 061_referral_code_gen_search_path.sql
-- Forward-only, same reasoning as 060: editing 053 in place does not get
-- replayed against a database where it already ran.
--
-- generate_referral_code() called gen_random_bytes() (pgcrypto) with no
-- pinned search_path. Supabase installs pgcrypto into the `extensions`
-- schema, not `public` — this function had no SECURITY DEFINER of its own
-- to otherwise fix a search_path, so resolution depended on the calling
-- session's search_path, which is not guaranteed to include `extensions`
-- (the SQL editor's default session doesn't). Symptom: "function
-- gen_random_bytes(integer) does not exist" from inside
-- get_or_create_referral_code(uuid) — every referrer's invite link/code
-- silently failed to generate (the TS caller catches the RPC error and
-- returns null, so the UI just showed no link, not an error).

CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS text
LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea := gen_random_bytes(5);
  v_bits     bigint;
  v_result   text := '';
  i          int;
  v_idx      int;
BEGIN
  v_bits := (get_byte(v_bytes, 0)::bigint << 32)
          | (get_byte(v_bytes, 1)::bigint << 24)
          | (get_byte(v_bytes, 2)::bigint << 16)
          | (get_byte(v_bytes, 3)::bigint << 8)
          |  get_byte(v_bytes, 4)::bigint;
  FOR i IN 0..7 LOOP
    v_idx := (v_bits >> ((7 - i) * 5)) & 31;
    v_result := v_result || substr(v_alphabet, v_idx + 1, 1);
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION generate_referral_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_referral_code() TO service_role;

NOTIFY pgrst, 'reload schema';
