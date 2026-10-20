-- 104_verified_visit_reports.sql
-- Member reporting for verified-visit content.
--
-- Google Play's user-generated content policy requires an in-app way to
-- report objectionable content. Akiba already pre-moderates — photos go
-- uploading -> processing -> pending -> approved|rejected|withdrawn and only
-- approved ones are ever published — so this is the reactive channel for
-- content that passed review and should not have, not the primary defence.
--
-- Blocking is deliberately not implemented. Verified visits are anonymous to
-- viewers: the native contract is { id, favoriteOrder, experienceLabels,
-- photos } with no author, username or avatar, and there are no profiles,
-- comments or messages. There is no user to block, so a block feature would
-- be a control that does nothing.
--
-- Shaped after merchant_verified_visit_helpful_reactions (migration 100):
-- same contribution_id key, same RLS-and-service-role-only posture. A report
-- is the other half of that pair — one says "this was good", one says "this
-- should not be here".

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS merchant_verified_visit_reports (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id      uuid NOT NULL
                         REFERENCES merchant_discovery_contributions(id) ON DELETE CASCADE,
  -- Optional. A visit card carries member-written text (favourite order,
  -- experience labels) as well as photos, so a report is filed against the
  -- card; this narrows it to one photo when that is what prompted it.
  photo_id             uuid REFERENCES merchant_visit_photos(id) ON DELETE CASCADE,
  reporter_hub_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Member-facing vocabulary, bounded so reports stay countable and so a
  -- free-text box can never carry someone's personal data into the queue.
  -- Each maps onto a moderator rejection reason from
  -- admin-dashboard/src/lib/discoveryModeration.ts:
  --   offensive, sexual_content, violence, spam -> policy_violation
  --   shows_a_person                            -> identifiable_person
  --   personal_information                      -> receipt_or_personal_info
  --   not_this_place                            -> not_merchant_related
  --   other                                     -> other
  reason_code          text NOT NULL CHECK (reason_code IN (
                         'offensive', 'sexual_content', 'violence', 'spam',
                         'shows_a_person', 'personal_information',
                         'not_this_place', 'other'
                       )),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'actioned', 'dismissed')),
  resolved_at          timestamptz,
  resolved_by          text,
  resolution_note      text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- One report per member per visit. Makes the route idempotent on retry and
  -- stops a single member filling the queue with the same complaint.
  UNIQUE (contribution_id, reporter_hub_user_id),

  -- A resolution is all-or-nothing: a row cannot claim it was handled
  -- without recording when and by whom.
  CONSTRAINT chk_visit_report_resolution
    CHECK ((status = 'pending'  AND resolved_at IS NULL AND resolved_by IS NULL)
        OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

-- The moderation queue's read: oldest unresolved first.
CREATE INDEX IF NOT EXISTS idx_visit_reports_pending
  ON merchant_verified_visit_reports (created_at)
  WHERE status = 'pending';

-- "Has this member already reported this?", and the account-deletion sweep.
CREATE INDEX IF NOT EXISTS idx_visit_reports_reporter
  ON merchant_verified_visit_reports (reporter_hub_user_id);

-- Everything a moderator needs about one card's complaints.
CREATE INDEX IF NOT EXISTS idx_visit_reports_contribution
  ON merchant_verified_visit_reports (contribution_id, created_at DESC);

ALTER TABLE merchant_verified_visit_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_verified_visit_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON merchant_verified_visit_reports TO service_role;

NOTIFY pgrst, 'reload schema';
