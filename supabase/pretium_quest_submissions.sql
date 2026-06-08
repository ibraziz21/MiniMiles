-- pretium_quest_submissions
-- Tracks user intent for Pretium partner quests.
-- Miles are NOT minted on submission — they are minted only after admin
-- confirms completion via POST /api/admin/pretium/confirm.

CREATE TABLE IF NOT EXISTS pretium_quest_submissions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address   text        NOT NULL,
  email          text        NOT NULL,
  quest_type     text        NOT NULL CHECK (quest_type IN ('signup', 'transact')),
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'confirmed', 'rejected')),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at   timestamptz,
  miles_minted   boolean     NOT NULL DEFAULT false,

  UNIQUE (user_address, quest_type)
);

CREATE INDEX IF NOT EXISTS pretium_quest_submissions_address_idx
  ON pretium_quest_submissions (user_address);

CREATE INDEX IF NOT EXISTS pretium_quest_submissions_status_idx
  ON pretium_quest_submissions (status);
