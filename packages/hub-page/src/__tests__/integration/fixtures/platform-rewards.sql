-- Identity links (wallet ↔ email ↔ phone ↔ social)
CREATE TABLE IF NOT EXISTS identity_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id   UUID NOT NULL,   -- stable internal user ID
  identity_type  TEXT NOT NULL CHECK (identity_type IN ('wallet','email','phone','youtube','google')),
  identity_value TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(identity_type, identity_value)
);
CREATE INDEX ON identity_links(canonical_id);
CREATE INDEX ON identity_links(identity_type, identity_value);

-- Pending miles for non-wallet users (email/phone)
CREATE TABLE IF NOT EXISTS pending_miles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_type  TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  source_type    TEXT NOT NULL CHECK (source_type IN ('merchant','campaign')),
  source_id      UUID NOT NULL,
  partner_id     UUID NOT NULL REFERENCES partners(id),
  claimed_at     TIMESTAMPTZ,
  claimed_wallet TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON pending_miles(identity_type, identity_value, claimed_at);

-- Universal Miles Ledger (append-only)
CREATE TABLE IF NOT EXISTS miles_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id  UUID NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  direction     TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  source_type   TEXT NOT NULL CHECK (source_type IN ('merchant','campaign','game','referral','claim','reversal')),
  source_id     UUID,
  partner_id    UUID REFERENCES partners(id),
  on_chain      BOOLEAN DEFAULT false,
  tx_hash       TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON miles_ledger(canonical_id, created_at DESC);

-- View: current balance per canonical_id
CREATE OR REPLACE VIEW user_miles_balance AS
  SELECT
    canonical_id,
    SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
  FROM miles_ledger
  GROUP BY canonical_id;

-- Immutability trigger — ledger rows can never be updated or deleted
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'miles_ledger rows are immutable. Insert a reversal entry instead.';
END;
$$;

CREATE TRIGGER no_ledger_updates
  BEFORE UPDATE OR DELETE ON miles_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
