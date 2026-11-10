-- Submit → Publish, requested 2026-11-10. Apply to the Platform database.
-- Existing approved rows remain publishable; approval routes remain compatible.
-- Row locks, expected revision, merchant readiness, template updates and audit
-- writes are retained. No data rows are changed by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION transition_voucher_funding_program_atomic(
  p_program_id UUID,p_action TEXT,p_actor_id UUID,p_reason TEXT,p_expected_revision INTEGER
) RETURNS voucher_funding_programs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_row voucher_funding_programs%ROWTYPE;v_next TEXT;
BEGIN
  SELECT * INTO v_row FROM voucher_funding_programs WHERE id=p_program_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROGRAM_NOT_FOUND' USING ERRCODE='P0001';END IF;

  v_next:=CASE
    WHEN p_action='submit'  AND v_row.state='draft'            THEN 'pending_approval'
    WHEN p_action='approve' AND v_row.state='pending_approval' THEN 'approved'
    WHEN p_action='reject'  AND v_row.state='pending_approval' THEN 'draft'
    WHEN p_action='publish' AND v_row.state IN('pending_approval','approved')
      THEN CASE WHEN v_row.starts_at<=now() THEN 'active' ELSE 'scheduled' END
    WHEN p_action='pause'   AND v_row.state IN('scheduled','active')  THEN 'paused'
    WHEN p_action='resume'  AND v_row.state='paused'                  THEN
      CASE WHEN v_row.starts_at<=now() THEN 'active' ELSE 'scheduled' END
    WHEN p_action='end'     AND v_row.state IN('scheduled','active','paused') THEN 'ended'
    WHEN p_action='cancel'  AND v_row.state IN('draft','pending_approval','approved') THEN 'cancelled'
    ELSE NULL
  END;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'PROGRAM_INVALID_STATE_TRANSITION: % from %',p_action,v_row.state
      USING ERRCODE='P0001';END IF;

  IF p_action='publish' THEN
    IF p_expected_revision IS NULL OR v_row.approval_revision<>p_expected_revision THEN
      RAISE EXCEPTION 'PROGRAM_APPROVAL_REVISION_MISMATCH' USING ERRCODE='P0001';END IF;
  END IF;
  IF p_action='approve' AND (p_reason IS NULL OR length(trim(p_reason))<4) THEN
    RAISE EXCEPTION 'PROGRAM_APPROVAL_REASON_REQUIRED' USING ERRCODE='P0001';END IF;
  IF p_action='cancel' AND EXISTS(
    SELECT 1 FROM voucher_claims vc JOIN voucher_funding_allocations a ON a.id=vc.allocation_id
    WHERE a.program_id=p_program_id
  ) THEN
    RAISE EXCEPTION 'PROGRAM_CANCEL_BLOCKED_BY_FUNDING_ACTIVITY' USING ERRCODE='P0001';END IF;

  UPDATE voucher_funding_programs SET
    state=v_next,version=version+1,updated_at=now(),
    approval_revision=CASE WHEN p_action='approve' THEN approval_revision+1 ELSE approval_revision END,
    approved_by=CASE WHEN p_action='approve' THEN p_actor_id ELSE approved_by END,
    approved_at=CASE WHEN p_action='approve' THEN now() ELSE approved_at END,
    approval_reason=CASE WHEN p_action='approve' THEN p_reason ELSE approval_reason END
  WHERE id=p_program_id RETURNING * INTO v_row;

  INSERT INTO audit_logs(actor_id,actor_type,entity_type,entity_id,action,after,metadata)
  VALUES(p_actor_id,'internal_user','voucher_funding_program',v_row.id,
    'program.'||p_action,to_jsonb(v_row),jsonb_build_object('reason',p_reason));
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION transition_voucher_funding_program_atomic(UUID,TEXT,UUID,TEXT,INTEGER)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION transition_voucher_funding_program_atomic(UUID,TEXT,UUID,TEXT,INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION transition_voucher_funding_allocation_atomic(
  p_allocation_id UUID,p_action TEXT,p_actor_id UUID,p_reason TEXT
) RETURNS voucher_funding_allocations
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_row voucher_funding_allocations%ROWTYPE;v_program voucher_funding_programs%ROWTYPE;
  v_next TEXT;v_template_active BOOLEAN;v_template_state TEXT;
  v_unready TEXT;
BEGIN
  SELECT * INTO v_row FROM voucher_funding_allocations WHERE id=p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ALLOCATION_NOT_FOUND' USING ERRCODE='P0001';END IF;
  SELECT * INTO v_program FROM voucher_funding_programs WHERE id=v_row.program_id;

  v_next:=CASE
    WHEN p_action='submit'  AND v_row.state='draft'             THEN 'pending_approval'
    WHEN p_action='approve' AND v_row.state='pending_approval'  THEN 'approved'
    WHEN p_action='reject'  AND v_row.state='pending_approval'  THEN 'draft'
    WHEN p_action='publish' AND v_row.state IN('pending_approval','approved')
      THEN CASE WHEN v_row.claim_starts_at<=now() THEN 'active' ELSE 'scheduled' END
    WHEN p_action='pause'   AND v_row.state IN('scheduled','active') THEN 'paused'
    WHEN p_action='resume'  AND v_row.state='paused'
      THEN CASE WHEN v_row.claim_starts_at<=now() THEN 'active' ELSE 'scheduled' END
    WHEN p_action='end'     AND v_row.state IN('scheduled','active','paused','exhausted') THEN 'ended'
    ELSE NULL
  END;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'ALLOCATION_INVALID_STATE_TRANSITION: % from %',p_action,v_row.state
      USING ERRCODE='P0001';END IF;

  IF p_action='publish' AND v_program.state NOT IN('active','scheduled') THEN
    RAISE EXCEPTION 'PROGRAM_NOT_LIVE' USING ERRCODE='P0001';END IF;

  -- Checked on publish and resume: resume makes a paused offer claimable
  -- again, and a merchant's subscription may have lapsed while it was paused.
  -- Named in the exception so an operator reading only the error still learns
  -- which merchant and why.
  IF p_action IN('publish','resume') THEN
    SELECT string_agg(r.merchant_name||' ('||r.reason||')', '; ' ORDER BY r.merchant_name)
      INTO v_unready
      FROM voucher_allocation_merchant_readiness(p_allocation_id) r
     WHERE NOT r.ready;
    IF v_unready IS NOT NULL THEN
      RAISE EXCEPTION 'MERCHANT_NOT_READY: %',v_unready USING ERRCODE='P0001';
    END IF;
  END IF;

  v_template_active:=CASE WHEN v_next IN('active','scheduled') THEN true ELSE false END;
  v_template_state:=CASE WHEN v_next IN('active','scheduled') THEN 'published' ELSE
    CASE WHEN v_next='draft' THEN 'draft' ELSE NULL END END;

  UPDATE voucher_funding_allocations SET state=v_next,version=version+1,updated_at=now()
    WHERE id=p_allocation_id RETURNING * INTO v_row;

  UPDATE spend_voucher_templates SET
    active=v_template_active,
    lifecycle_state=COALESCE(v_template_state,lifecycle_state),
    published_at=CASE WHEN p_action='publish' THEN now() ELSE published_at END,
    updated_at=now()
  WHERE id=v_row.voucher_template_id;

  INSERT INTO audit_logs(actor_id,actor_type,entity_type,entity_id,action,after,metadata)
  VALUES(p_actor_id,'internal_user','voucher_funding_allocation',v_row.id,
    'allocation.'||p_action,to_jsonb(v_row),jsonb_build_object('reason',p_reason));
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION transition_voucher_funding_allocation_atomic(UUID,TEXT,UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION transition_voucher_funding_allocation_atomic(UUID,TEXT,UUID,TEXT)
  TO service_role;

COMMENT ON FUNCTION transition_voucher_funding_allocation_atomic(UUID,TEXT,UUID,TEXT) IS
  'Allocation state machine (156). publish and resume additionally refuse when any participating merchant could not honour the offer, raising MERCHANT_NOT_READY with each merchant''s name and reason. Enforced here rather than only in the API so it holds whatever a form displayed.';

COMMIT;
