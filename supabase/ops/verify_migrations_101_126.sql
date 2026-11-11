-- verify_migrations_101_126.sql
-- READ-ONLY. Paste into the Supabase SQL editor (production) and run.
--
-- Checks that MiniMiles migrations 101–126 are live (101–122 are what
-- 123–126 build on; 120 is a one-off data fix and isn't checked) by looking for what each
-- one creates, rather than trusting supabase_migrations.schema_migrations:
-- the two repositories number independently against one database, and a
-- migration pasted into the SQL editor is never recorded there.
--
-- Every row should say ok = true. Any false row names the migration that is
-- missing; apply missing ones in number order.

WITH fn AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'enqueue_web_push_job', 'record_offer_sightings', 'queue_voucher_expiry_reminders',
       'akiba_push_daytime', 'enrol_welcome_offer', 'get_welcome_offer', 'welcome_offer_summary',
       'claim_akiba_funded_voucher_atomic', 'voucher_allocation_eligible_merchants',
       'create_voucher_funding_allocation_atomic', 'snapshot_funded_allocation_merchants',
       'funded_redemption_day_allowed', 'initialize_merchant_verified_visits',
       'get_admin_pass_demographics', 'reserve_voucher_purchase'
     )
)
SELECT migration, check_name, ok FROM (VALUES
  -- 101–122: what 123–126 build on
  ('101', 'hub_user_devices table', to_regclass('public.hub_user_devices') IS NOT NULL),
  ('101', 'native_push_deliveries table', to_regclass('public.native_push_deliveries') IS NOT NULL),
  ('102', 'immediate push dispatch trigger',
     EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_web_push_jobs_dispatch' AND NOT tgisinternal)),
  ('112/114', 'funded_redemption_day_allowed function',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'funded_redemption_day_allowed')),
  ('113', 'snapshot_funded_allocation_merchants function',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'snapshot_funded_allocation_merchants')),
  ('113', 'claim RPC is the multi-merchant version',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'claim_akiba_funded_voucher_atomic'
              AND body LIKE '%voucher_allocation_eligible_merchants%')),
  ('115', 'initialize_merchant_verified_visits function',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'initialize_merchant_verified_visits')),
  ('118', 'get_admin_pass_demographics function',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'get_admin_pass_demographics')),
  ('119', 'hub_user_passes.onboarding_required column',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'hub_user_passes' AND column_name = 'onboarding_required')),
  ('121', 'merchant_discovery_contributions.private_note column',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'merchant_discovery_contributions' AND column_name = 'private_note')),
  ('122', 'reserve_voucher_purchase uses schema-qualified digest',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'reserve_voucher_purchase')
     AND NOT EXISTS (SELECT 1 FROM fn WHERE proname = 'reserve_voucher_purchase' AND body LIKE '%encode(digest(%')),

  -- 123 contribution request push
  ('123', 'push trigger knows contribution_requested',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'enqueue_web_push_job' AND body LIKE '%contribution_requested%')),
  ('123', 'recommendation push held back 45 minutes',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'enqueue_web_push_job' AND body LIKE '%45 minutes%')),

  -- 124 native push receipts
  ('124', 'native_push_deliveries.receipt_status column',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'native_push_deliveries' AND column_name = 'receipt_status')),
  ('124', 'receipt poller index',
     to_regclass('public.idx_native_push_deliveries_receipt_pending') IS NOT NULL),

  -- 125 saved-place offers and voucher expiry pushes
  ('125', 'hub_offer_sightings table', to_regclass('public.hub_offer_sightings') IS NOT NULL),
  ('125', 'hub_offer_sighting_sources table', to_regclass('public.hub_offer_sighting_sources') IS NOT NULL),
  ('125', 'hub_voucher_expiry_reminders table', to_regclass('public.hub_voucher_expiry_reminders') IS NOT NULL),
  ('125', 'record_offer_sightings function', EXISTS (SELECT 1 FROM fn WHERE proname = 'record_offer_sightings')),
  ('125', 'queue_voucher_expiry_reminders function', EXISTS (SELECT 1 FROM fn WHERE proname = 'queue_voucher_expiry_reminders')),
  ('125', 'push trigger knows saved_place_offer and voucher_expiring',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'enqueue_web_push_job'
              AND body LIKE '%saved_place_offer%' AND body LIKE '%voucher_expiring%')),

  -- 126 welcome offer (needs Akiba-Platform 154/155 first)
  ('126 prereq', 'Platform 154: voucher_allocation_eligible_merchants',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'voucher_allocation_eligible_merchants')),
  ('126 prereq', 'Platform 155: create_voucher_funding_allocation_atomic',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'create_voucher_funding_allocation_atomic')),
  ('126', 'welcome_offer_campaigns table', to_regclass('public.welcome_offer_campaigns') IS NOT NULL),
  ('126', 'welcome_offer_enrolments table', to_regclass('public.welcome_offer_enrolments') IS NOT NULL),
  ('126', 'enrol_welcome_offer function', EXISTS (SELECT 1 FROM fn WHERE proname = 'enrol_welcome_offer')),
  ('126', 'get_welcome_offer function', EXISTS (SELECT 1 FROM fn WHERE proname = 'get_welcome_offer')),
  ('126', 'claim RPC allows auto_award only for the welcome enrolment',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'claim_akiba_funded_voucher_atomic' AND body LIKE '%akiba.welcome_enrolment%'))
) AS checks(migration, check_name, ok)
ORDER BY migration, check_name;
