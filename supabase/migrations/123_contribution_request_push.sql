-- 123_contribution_request_push.sql
-- "How was <merchant>?" push after a verified in-store visit.
--
-- When the Hub opens a discovery contribution request (a member earned Miles
-- in store at a merchant that takes recommendations), it now also writes a
-- `contribution_requested` row to notification_outbox
-- (src/lib/akiba/contributionRequestNotification.ts). This migration adds
-- that template to the push whitelist and holds its job back 45 minutes:
-- asking "how was it?" while the member is still at the till reads as noise,
-- and the Miles-earned push already covers that moment.
--
-- The delay uses the existing web_push_jobs.available_at, which
-- claim_web_push_jobs already honours (047), so the immediate-dispatch
-- trigger (102) waking the worker early is harmless — the job simply isn't
-- claimable yet. The dispatcher re-checks the request is still open before
-- sending, so a member who already left a recommendation is not asked.
--
-- Category is `earnings`: it rides the same opt-out as Miles-earned pushes
-- rather than adding a preference toggle for one prompt.
--
-- Everything else in enqueue_web_push_job is reproduced unchanged from
-- 069_earnings_notifications.sql.

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
       'miles_earned',
       'contribution_requested'
     )
  THEN
    INSERT INTO web_push_jobs(notification_id, hub_user_id, available_at)
    VALUES (
      NEW.id,
      NEW.hub_user_id,
      CASE WHEN NEW.template = 'contribution_requested'
        THEN now() + interval '45 minutes'
        ELSE now()
      END
    )
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;
