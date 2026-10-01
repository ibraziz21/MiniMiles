-- Activate the verified post-purchase contribution pilot for Arabica Coffee
-- House. The request-creation function remains the enforcement point; this
-- synchronized settings row explicitly opts this merchant into the pilot.
-- Structured answers and optional customer-photo collection are enabled for
-- this closed pilot. This does not publish either: public projections remain
-- separately thresholded, moderated and disabled until their launch gates.

INSERT INTO merchant_discovery_settings (
  partner_id,
  contributions_enabled,
  structured_proof_enabled,
  customer_photos_enabled,
  social_showcase_enabled,
  updated_by,
  updated_at
)
SELECT
  id,
  true,
  true,
  true,
  false,
  'migration:087_arabica_verified_discovery_pilot',
  now()
FROM partners
WHERE slug = 'arabica-1976-information'
  AND type = 'merchant'
  AND status = 'active'
ON CONFLICT (partner_id) DO UPDATE SET
  contributions_enabled = EXCLUDED.contributions_enabled,
  structured_proof_enabled = EXCLUDED.structured_proof_enabled,
  customer_photos_enabled = EXCLUDED.customer_photos_enabled,
  updated_by = EXCLUDED.updated_by,
  updated_at = EXCLUDED.updated_at;
