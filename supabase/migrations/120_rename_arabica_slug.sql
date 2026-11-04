-- Rename Arabica Coffee House's public slug from the data-entry artefact
-- 'arabica-1976-information' to 'arabica-coffee'.
--
-- Why now: the profile is noindex and absent from every sitemap — its
-- description is below the indexability threshold — so the old slug carries no
-- search equity whatsoever. Renaming costs nothing today and is expensive once
-- the profile is indexed and linked.
--
-- ORDERING MATTERS. 087_arabica_verified_discovery_pilot.sql resolves this
-- merchant BY SLUG to seed merchant_discovery_settings, and its INSERT ...
-- SELECT inserts nothing (silently, with no error) when the slug does not
-- match. On a replay from an empty database 087 must still find the old value,
-- so this rename has to run after it. Never fold this into 087, and never
-- change the slug literal in 087 to match this one.
--
-- Nothing in the application hardcodes a slug: every lookup resolves it per
-- request. The old URL is handled by a redirect in the Pass app's
-- next.config.mjs so links already shared keep working.

DO $$
DECLARE
  v_partner_id uuid;
  v_conflicting_id uuid;
BEGIN
  SELECT id INTO v_partner_id
  FROM partners
  WHERE slug = 'arabica-1976-information'
    AND type = 'merchant';

  IF v_partner_id IS NULL THEN
    -- Already renamed, or this database never had the pilot merchant. Both are
    -- legitimate on a replay, so report rather than fail.
    RAISE NOTICE '120_rename_arabica_slug: no partner with slug arabica-1976-information; nothing to do';
    RETURN;
  END IF;

  -- A unique index would turn a collision into a constraint error that the
  -- admin API reports as a generic 500. Checking here names the culprit.
  SELECT id INTO v_conflicting_id
  FROM partners
  WHERE slug = 'arabica-coffee'
    AND id <> v_partner_id;

  IF v_conflicting_id IS NOT NULL THEN
    RAISE EXCEPTION
      '120_rename_arabica_slug: slug arabica-coffee is already used by partner %', v_conflicting_id;
  END IF;

  UPDATE partners
  SET slug = 'arabica-coffee'
  WHERE id = v_partner_id;

  RAISE NOTICE '120_rename_arabica_slug: renamed partner % to arabica-coffee', v_partner_id;
END $$;
