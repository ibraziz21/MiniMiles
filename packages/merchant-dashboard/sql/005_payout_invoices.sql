-- 005_payout_invoices.sql
-- Payout invoices: merchants create monthly invoices to request payment from AkibaMiles.
-- Rows transition draft → submitted → paid | rejected (append-only status history via audit).

CREATE TABLE IF NOT EXISTS payout_invoices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid        NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  -- Billing period (the calendar month this invoice covers)
  period_month        text        NOT NULL,  -- "YYYY-MM"

  -- Amounts computed at submission time from completed orders in the period
  order_count         integer     NOT NULL DEFAULT 0,
  gross_cusd          numeric(12,2) NOT NULL DEFAULT 0,

  -- Optional notes from the merchant (e.g. disputes, context)
  notes               text,

  -- Invoice lifecycle status
  status              text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'paid', 'rejected')),

  -- Who created and submitted
  created_by          uuid        NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
  submitted_by        uuid        REFERENCES merchant_users(id) ON DELETE RESTRICT,
  submitted_at        timestamptz,

  -- AkibaMiles response
  akiba_notes         text,       -- rejection reason or payment reference from our side
  resolved_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One invoice per partner per month (prevents duplicate submissions)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_invoice_partner_month
  ON payout_invoices (partner_id, period_month);

CREATE INDEX IF NOT EXISTS idx_payout_invoices_partner ON payout_invoices (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_invoices_status  ON payout_invoices (status);

CREATE OR REPLACE FUNCTION update_payout_invoices_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_payout_invoices_updated_at ON payout_invoices;
CREATE TRIGGER trg_payout_invoices_updated_at
  BEFORE UPDATE ON payout_invoices
  FOR EACH ROW EXECUTE FUNCTION update_payout_invoices_updated_at();
