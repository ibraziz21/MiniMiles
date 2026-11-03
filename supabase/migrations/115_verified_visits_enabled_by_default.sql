-- Verified visits are available to every merchant without merchant opt-in.
BEGIN;

ALTER TABLE public.merchant_discovery_settings
  ALTER COLUMN contributions_enabled SET DEFAULT true;

INSERT INTO public.merchant_discovery_settings (partner_id, contributions_enabled)
SELECT id, true FROM public.partners WHERE type = 'merchant'
ON CONFLICT (partner_id) DO UPDATE
SET contributions_enabled = true, updated_at = now();

CREATE OR REPLACE FUNCTION public.initialize_merchant_verified_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type = 'merchant' THEN
    INSERT INTO public.merchant_discovery_settings (partner_id, contributions_enabled)
    VALUES (NEW.id, true)
    ON CONFLICT (partner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_merchant_verified_visits() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_initialize_merchant_verified_visits ON public.partners;
CREATE TRIGGER trg_initialize_merchant_verified_visits
AFTER INSERT OR UPDATE OF type ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.initialize_merchant_verified_visits();

COMMIT;
