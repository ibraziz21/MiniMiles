-- 069_earnings_notifications.sql
-- Earned-Miles transactional notifications
-- (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §6/§7).
--
-- Adds the `earnings` preference/category/template to the existing
-- notification_outbox + web_push_jobs pipeline (047_web_push_notifications.sql,
-- extended by 057_referral_notifications.sql) rather than building a new one.
-- The producer itself lives in application code (src/lib/akiba/
-- milesEarnedNotification.ts) since it needs getNextRewardSummary() —
-- unlike the SQL-native voucher/referral producers, this one is called from
-- TS after a Hub order's reward release, or from the internal
-- /api/internal/miles-credited endpoint for Platform-sourced merchant-scan
-- events, and inserts directly into notification_outbox (already granted to
-- service_role by 036_disputes_notifications_reconciliation.sql).

-- ── Preferences (§6.6) ───────────────────────────────────────────────────
ALTER TABLE hub_notification_preferences
  ADD COLUMN IF NOT EXISTS earnings_enabled boolean NOT NULL DEFAULT true;

-- ── notification_outbox category (§7.2) ───────────────────────────────────
ALTER TABLE notification_outbox
  DROP CONSTRAINT IF EXISTS chk_notification_outbox_category;
ALTER TABLE notification_outbox
  ADD CONSTRAINT chk_notification_outbox_category
  CHECK (category IS NULL OR category IN ('orders', 'refunds', 'vouchers', 'rewards', 'marketing', 'earnings'));

-- ── enqueue_web_push_job (§7.3): extend the push-eligible whitelist to the
--    'earnings' category / 'miles_earned' template — everything else in
--    this function (reproduced from 057_referral_notifications.sql) is
--    unchanged. earnings_enabled defaults true (unlike rewards_enabled),
--    matching §6.6's "a member who explicitly enables Akiba notifications
--    receives transaction confirmations ... unless they switch that
--    category off". ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND NEW.category IN ('orders', 'refunds', 'vouchers', 'rewards', 'earnings')
     AND NEW.template IN (
       'order_placed', 'order_accepted', 'order_dispatched',
       'order_delivered', 'digital_delivered', 'order_cancelled',
       'refund_initiated', 'refund_completed', 'refund_failed',
       'voucher_ready', 'voucher_failed', 'voucher_reconciliation',
       'referral_signup_held', 'referral_signup_released',
       'referral_activation_held', 'referral_activation_released',
       'referral_manual_review',
       'miles_earned'
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id)
    VALUES (NEW.id, NEW.hub_user_id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

NOTIFY pgrst, 'reload schema';
