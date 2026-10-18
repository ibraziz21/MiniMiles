-- Verified Visit browsing actions and a privacy-safe merchant favorite.
--
-- Helpful is deliberately a private member preference: no public reaction
-- count is exposed, and one member can toggle at most one row per visit.
-- The favorite product remains an aggregate claim. Raw per-contribution
-- item text must never be attached to an anonymous visit card.

CREATE TABLE IF NOT EXISTS merchant_verified_visit_helpful_reactions (
  contribution_id uuid NOT NULL
    REFERENCES merchant_discovery_contributions(id) ON DELETE CASCADE,
  hub_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, hub_user_id)
);

CREATE INDEX IF NOT EXISTS idx_verified_visit_helpful_reactions_member
  ON merchant_verified_visit_helpful_reactions (hub_user_id, created_at DESC);

ALTER TABLE merchant_verified_visit_helpful_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON merchant_verified_visit_helpful_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON merchant_verified_visit_helpful_reactions TO service_role;

-- One deck card per member, using their newest eligible contribution for the
-- merchant. The stable member key is returned only to the service-role
-- backend for defense-in-depth deduplication and is never serialized to a
-- public client.
--
-- DROP is required when rerunning this migration after the returned row
-- shape gains a column: PostgreSQL cannot change OUT parameters through
-- CREATE OR REPLACE. Drop the aggregate reader first because it calls the
-- card projection below.
DROP FUNCTION IF EXISTS get_public_verified_visit_favorite(uuid);
DROP FUNCTION IF EXISTS eligible_public_merchant_visit_cards(uuid);

CREATE OR REPLACE FUNCTION eligible_public_merchant_visit_cards(p_partner_id uuid)
RETURNS TABLE (
  contribution_id        uuid,
  partner_id             uuid,
  submitted_at           timestamptz,
  experience_option_ids  text[],
  template_snapshot      jsonb,
  dedup_key              text,
  favorite_order         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    picked.contribution_id,
    picked.partner_id,
    picked.submitted_at,
    picked.experience_option_ids,
    picked.template_snapshot,
    picked.dedup_key,
    favorite.favorite_order
  FROM (
    SELECT DISTINCT ON (contribution.hub_user_id)
      eligible.contribution_id,
      eligible.partner_id,
      eligible.submitted_at,
      eligible.experience_option_ids,
      eligible.template_snapshot,
      md5(contribution.hub_user_id::text || ':' || eligible.partner_id::text) AS dedup_key
    FROM eligible_public_discovery_contributions eligible
    JOIN merchant_discovery_contributions contribution
      ON contribution.id = eligible.contribution_id
    WHERE eligible.partner_id = p_partner_id
    ORDER BY
      contribution.hub_user_id,
      eligible.submitted_at DESC,
      eligible.contribution_id DESC
  ) picked
  LEFT JOIN LATERAL (
    SELECT item.canonical_name AS favorite_order
    FROM merchant_discovery_contribution_items contribution_item
    JOIN merchant_discovery_item_mentions mention
      ON mention.id = contribution_item.item_mention_id
      AND mention.moderation_status = 'accepted'
    JOIN merchant_discovery_items item
      ON item.id = mention.canonical_item_id
      AND item.partner_id = picked.partner_id
      AND item.status = 'qualified'
    WHERE contribution_item.contribution_id = picked.contribution_id
      AND contribution_item.is_recommended = true
    ORDER BY contribution_item.created_at ASC, item.canonical_name ASC
    LIMIT 1
  ) favorite ON true
  ORDER BY picked.submitted_at DESC, picked.contribution_id DESC;
$$;

REVOKE ALL ON FUNCTION eligible_public_merchant_visit_cards(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION eligible_public_merchant_visit_cards(uuid)
  TO service_role;

-- Returns at most one already-qualified aggregate item for a merchant.
-- A pending/failed projection job makes the value unavailable, matching the
-- fail-closed rule used by the public Discovery snapshot read path.
CREATE OR REPLACE FUNCTION get_public_verified_visit_favorite(p_partner_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT favorite.value
  FROM merchant_discovery_public_snapshots snapshot
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(snapshot.qualified_recommended_items, '[]'::jsonb)
  ) WITH ORDINALITY AS favorite(value, position)
  WHERE snapshot.partner_id = p_partner_id
    AND snapshot.suppression_reason IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM merchant_discovery_projection_jobs job
      WHERE job.partner_id = snapshot.partner_id
        AND job.status IN ('pending', 'processing', 'failed')
    )
    AND EXISTS (
      SELECT 1
      FROM eligible_public_merchant_visit_cards(snapshot.partner_id)
    )
  ORDER BY favorite.position
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_verified_visit_favorite(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_verified_visit_favorite(uuid)
  TO service_role;
