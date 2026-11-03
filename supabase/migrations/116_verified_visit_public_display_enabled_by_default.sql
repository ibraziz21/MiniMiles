-- Complete the default-on verified visit policy: collection and public cards.
BEGIN;
ALTER TABLE public.merchant_discovery_settings
  ALTER COLUMN structured_proof_enabled SET DEFAULT true;
UPDATE public.merchant_discovery_settings SET structured_proof_enabled = true
WHERE NOT structured_proof_enabled;

CREATE OR REPLACE FUNCTION public.initialize_merchant_verified_visits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'merchant' THEN
    INSERT INTO public.merchant_discovery_settings
      (partner_id, contributions_enabled, structured_proof_enabled)
    VALUES (NEW.id, true, true)
    ON CONFLICT (partner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_merchant_verified_visits() FROM PUBLIC;
COMMIT;
