-- Run against an EMPTY, disposable PostgreSQL database, never a deployed one.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.hub_user_passes (id integer);
INSERT INTO public.hub_user_passes VALUES (1);
\ir ../../../../supabase/migrations/119_web_pass_onboarding.sql
INSERT INTO public.hub_user_passes(id) VALUES (2);
DO $$ BEGIN
 ASSERT (SELECT onboarding_required = false FROM hub_user_passes WHERE id = 1), 'Existing members must not be forced through onboarding';
 ASSERT (SELECT onboarding_required = true FROM hub_user_passes WHERE id = 2), 'New Pass holders must enter onboarding';
END $$;
ROLLBACK;
