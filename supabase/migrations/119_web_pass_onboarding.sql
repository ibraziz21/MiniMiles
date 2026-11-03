-- Existing Pass holders keep their current experience. Only future Pass
-- rows enter the new web onboarding; completion is shared with native.
ALTER TABLE public.hub_user_passes
  ADD COLUMN IF NOT EXISTS onboarding_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.hub_user_passes
  ALTER COLUMN onboarding_required SET DEFAULT true;
COMMENT ON COLUMN public.hub_user_passes.onboarding_required IS
  'New-signup web onboarding cohort. Existing rows are false; future rows default true. onboarding_seen_at records shared web/native completion.';
