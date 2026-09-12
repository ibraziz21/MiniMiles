-- 073_restore_marketing_push_enqueue.sql
-- Restore marketing campaign delivery after migration 069 replaced
-- enqueue_web_push_job() with an earnings-aware allowlist that accidentally
-- omitted the marketing category and announcement templates added in 062.

-- Keep push eligibility in one predicate so later notification categories can
-- extend it without having to duplicate the complete trigger condition.
CREATE OR REPLACE FUNCTION web_push_notification_is_eligible(
  p_category text,
  p_template text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_category IN ('orders', 'refunds', 'vouchers', 'rewards') THEN
        p_template IN (
          'order_placed', 'order_accepted', 'order_dispatched',
          'order_delivered', 'digital_delivered', 'order_cancelled',
          'refund_initiated', 'refund_completed', 'refund_failed',
          'voucher_ready', 'voucher_failed', 'voucher_reconciliation',
          'referral_signup_held', 'referral_signup_released',
          'referral_activation_held', 'referral_activation_released',
          'referral_manual_review'
        )
      WHEN p_category = 'marketing' THEN
        p_template IN (
          'feature_announcement',
          'merchant_announcement',
          'general_announcement'
        )
      WHEN p_category = 'earnings' THEN
        p_template = 'miles_earned'
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION enqueue_web_push_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_user_id IS NOT NULL
     AND web_push_notification_is_eligible(NEW.category, NEW.template)
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id)
    VALUES (NEW.id, NEW.hub_user_id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

-- Repair campaign notifications created while the broken trigger from 069 was
-- active. Existing jobs are preserved, making this safe to reapply.
INSERT INTO web_push_jobs(notification_id, hub_user_id)
SELECT n.id, n.hub_user_id
FROM notification_outbox n
WHERE n.hub_user_id IS NOT NULL
  AND n.campaign_id IS NOT NULL
  AND n.category = 'marketing'
  AND n.template IN (
    'feature_announcement',
    'merchant_announcement',
    'general_announcement'
  )
ON CONFLICT (notification_id) DO NOTHING;

REVOKE ALL ON FUNCTION web_push_notification_is_eligible(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION web_push_notification_is_eligible(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
