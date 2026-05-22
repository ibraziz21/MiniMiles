-- ── Supabase Realtime / pg_notify for new orders ─────────────────────────────
-- This trigger fires whenever a new row is inserted into merchant_transactions
-- with status = 'placed'. The dashboard can subscribe via Supabase Realtime
-- or a postgres LISTEN channel.

CREATE OR REPLACE FUNCTION notify_new_merchant_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'placed' THEN
    PERFORM pg_notify(
      'new_merchant_order',
      json_build_object(
        'id',         NEW.id,
        'partner_id', NEW.partner_id,
        'created_at', NEW.created_at
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_merchant_order ON merchant_transactions;
CREATE TRIGGER trg_notify_new_merchant_order
  AFTER INSERT ON merchant_transactions
  FOR EACH ROW EXECUTE FUNCTION notify_new_merchant_order();
