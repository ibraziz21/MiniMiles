-- 078_loyalty_voucher_offers_listing.sql
-- Lists loyalty-qualified-vouchers offers (Akiba-Platform:
-- docs/loyalty-qualified-vouchers-spec.md) for the Hub's /vouchers page —
-- the discovery half of the bridge into the existing voucher UI. The claim
-- half proxies to Akiba-Platform's own /api/v1/voucher-offers/:id/claim over
-- HTTP (same pattern as app/api/voucher-funding/[allocationId]/claim), so no
-- claim RPC is needed here.
--
-- spend_voucher_templates.access_policy/acquisition_mode/qualification_rule_set_id,
-- voucher_qualification_rule_sets, voucher_acquisition_claims, and the
-- merchant_loyalty_qualification_facts/evaluate_merchant_loyalty_rules
-- functions all live in the same Postgres project as this migration
-- (Akiba-Platform migrations 132-134) — called directly, no cross-service
-- call needed for a read-only listing.
--
-- Existing pre-loyalty public+Miles templates are untouched by this function:
-- they keep using list_available_voucher_template_ids_hub (046) and the
-- voucher_programs/channel-allocation path exactly as before. This only
-- covers what that path structurally cannot represent — any
-- access_policy='loyalty_qualified' template, or any acquisition_mode='free'
-- template (a free voucher has no "miles_purchase channel" to allocate).

CREATE OR REPLACE FUNCTION list_loyalty_voucher_offers_hub(
  p_hub_user_id uuid,
  p_email       text
)
RETURNS TABLE(
  template_id             uuid,
  title                   text,
  description             text,
  voucher_type            text,
  discount_percent        numeric,
  discount_kes            numeric,
  retail_value_kes        numeric,
  minimum_spend_kes       numeric,
  maximum_discount_kes    numeric,
  merchant_id             uuid,
  merchant_name           text,
  merchant_slug           text,
  merchant_image_url      text,
  access_policy           text,
  acquisition_mode        text,
  miles_cost              integer,
  qualification_mode      text,
  customer_copy           text,
  progress                jsonb,
  eligible                boolean,
  already_claimed         boolean,
  remaining               integer,
  ends_at                 timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical_id uuid;
  v_row          record;
  v_rule_set     record;
  v_facts        record;
  v_evaluation   jsonb;
  v_eligible     boolean;
  v_issued       integer;
BEGIN
  -- Same resolution shape as vouchers/page.tsx's getClaimedAllocationIds():
  -- email-keyed identity_links lookup, falling back to the Hub user id.
  v_canonical_id := p_hub_user_id;
  IF p_email IS NOT NULL THEN
    SELECT il.canonical_id INTO v_canonical_id
    FROM identity_links il
    WHERE il.identity_type = 'email' AND il.identity_value = p_email
    ORDER BY il.created_at ASC LIMIT 1;
    IF v_canonical_id IS NULL THEN v_canonical_id := p_hub_user_id; END IF;
  END IF;

  FOR v_row IN
    SELECT svt.*, p.name AS p_name, p.slug AS p_slug, p.image_url AS p_image_url, p.status AS p_status
    FROM spend_voucher_templates svt
    JOIN partners p ON p.id = svt.partner_id
    WHERE svt.lifecycle_state = 'published'
      AND svt.active = true
      AND (svt.start_at IS NULL OR svt.start_at <= now())
      AND (svt.end_at IS NULL OR svt.end_at > now())
      AND (svt.access_policy = 'loyalty_qualified' OR svt.acquisition_mode = 'free')
      AND svt.access_policy <> 'managed_allocation'
      AND p.status = 'active'
  LOOP
    IF v_row.global_cap IS NOT NULL THEN
      SELECT COUNT(*) INTO v_issued FROM issued_vouchers iv
      WHERE iv.voucher_template_id = v_row.id AND iv.status NOT IN ('void','expired');
      IF v_issued >= v_row.global_cap THEN CONTINUE; END IF;
      remaining := v_row.global_cap - v_issued;
    ELSE
      remaining := NULL;
    END IF;

    already_claimed := EXISTS(
      SELECT 1 FROM voucher_acquisition_claims vac
      WHERE vac.voucher_template_id = v_row.id AND vac.canonical_id = v_canonical_id
    );

    qualification_mode := NULL; customer_copy := NULL; progress := '[]'::jsonb; v_eligible := true;
    IF v_row.access_policy = 'loyalty_qualified' THEN
      SELECT vqrs.mode, vqrs.rules, vqrs.customer_copy INTO v_rule_set
      FROM voucher_qualification_rule_sets vqrs
      WHERE vqrs.id = v_row.qualification_rule_set_id;
      IF NOT FOUND THEN CONTINUE; END IF; -- shouldn't happen for a published loyalty template

      SELECT f.purchase_count, f.net_spend_kes INTO v_facts
      FROM merchant_loyalty_qualification_facts(v_row.partner_id, v_canonical_id) f;
      v_evaluation := evaluate_merchant_loyalty_rules(
        v_rule_set.mode, v_rule_set.rules, v_facts.purchase_count, v_facts.net_spend_kes
      );
      v_eligible := (v_evaluation->>'eligible')::boolean;
      qualification_mode := v_rule_set.mode;
      customer_copy := v_rule_set.customer_copy;
      progress := v_evaluation->'outcomes';

      -- Hidden-until-qualified: absent from discovery until eligible, unless
      -- already claimed (spec §15.2/§15.3).
      IF NOT already_claimed AND NOT v_eligible AND v_row.locked_offer_visibility = 'hidden_until_qualified' THEN
        CONTINUE;
      END IF;
    END IF;

    template_id := v_row.id;
    title := v_row.title;
    description := v_row.description;
    voucher_type := v_row.voucher_type;
    discount_percent := v_row.discount_percent;
    discount_kes := v_row.discount_kes;
    retail_value_kes := v_row.retail_value_kes;
    minimum_spend_kes := v_row.minimum_spend_kes;
    maximum_discount_kes := v_row.maximum_discount_kes;
    merchant_id := v_row.partner_id;
    merchant_name := v_row.p_name;
    merchant_slug := v_row.p_slug;
    merchant_image_url := v_row.p_image_url;
    access_policy := v_row.access_policy;
    acquisition_mode := v_row.acquisition_mode;
    miles_cost := CASE WHEN v_row.acquisition_mode = 'free' THEN 0 ELSE v_row.miles_cost END;
    eligible := v_eligible;
    ends_at := v_row.end_at;

    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION list_loyalty_voucher_offers_hub(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_loyalty_voucher_offers_hub(uuid,text) TO service_role;
