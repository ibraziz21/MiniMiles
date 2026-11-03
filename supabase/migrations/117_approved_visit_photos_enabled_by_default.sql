-- Admin approval controls individual photo publication; merchants need no opt-in.
BEGIN;
ALTER TABLE public.merchant_discovery_settings
  ALTER COLUMN contributions_enabled SET DEFAULT true,
  ALTER COLUMN structured_proof_enabled SET DEFAULT true,
  ALTER COLUMN customer_photos_enabled SET DEFAULT true;

UPDATE public.merchant_discovery_settings
SET contributions_enabled = true, structured_proof_enabled = true,
    customer_photos_enabled = true
WHERE NOT contributions_enabled OR NOT structured_proof_enabled OR NOT customer_photos_enabled;

CREATE OR REPLACE FUNCTION public.initialize_merchant_verified_visits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'merchant' THEN
    INSERT INTO public.merchant_discovery_settings
      (partner_id, contributions_enabled, structured_proof_enabled, customer_photos_enabled)
    VALUES (NEW.id, true, true, true)
    ON CONFLICT (partner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_merchant_verified_visits() FROM PUBLIC;
COMMIT;
