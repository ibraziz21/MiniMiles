-- Atomic moderation + resolution. Deploy after 104; no shared identity changes.
CREATE OR REPLACE FUNCTION public.resolve_verified_visit_report(
  p_report_id uuid, p_action text, p_reason text, p_actor_id text,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.merchant_verified_visit_reports; c public.merchant_discovery_contributions;
  photo_id_to_hide uuid; outcome record;
BEGIN
  IF nullif(trim(p_actor_id),'') IS NULL OR nullif(trim(p_correlation_id),'') IS NULL THEN
    RAISE EXCEPTION 'named actor required' USING ERRCODE='22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('hide_photo','hide_visit','dismiss') OR p_reason IS NULL OR
    (p_action='dismiss' AND p_reason NOT IN ('no_violation','insufficient_evidence','already_handled')) OR
    (p_action<>'dismiss' AND p_reason NOT IN ('policy_violation','identifiable_person','not_merchant_related','receipt_or_personal_info','other')) THEN
    RAISE EXCEPTION 'invalid resolution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO r FROM public.merchant_verified_visit_reports WHERE id=p_report_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error_code','not_found'); END IF;
  IF r.status<>'pending' THEN RETURN jsonb_build_object('ok',false,'error_code','already_resolved'); END IF;
  SELECT * INTO c FROM public.merchant_discovery_contributions WHERE id=r.contribution_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'visit missing' USING ERRCODE='55000'; END IF;
  IF p_action='hide_photo' THEN
    IF r.photo_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.merchant_visit_photos
      WHERE id=r.photo_id AND contribution_id=r.contribution_id) THEN
      RETURN jsonb_build_object('ok',false,'error_code','invalid_photo');
    END IF;
  END IF;
  IF p_action IN ('hide_photo','hide_visit') THEN
    -- Stable photo order; reuse existing suppression audits and refresh jobs.
    FOR photo_id_to_hide IN SELECT id FROM public.merchant_visit_photos
      WHERE contribution_id=r.contribution_id AND (p_action='hide_visit' OR id=r.photo_id)
      ORDER BY id FOR UPDATE
    LOOP
      IF EXISTS (SELECT 1 FROM public.merchant_visit_photos WHERE id=photo_id_to_hide AND suppressed_at IS NULL) THEN
        SELECT * INTO outcome FROM public.set_visit_photo_suppression(
          photo_id_to_hide,true,p_actor_id,p_correlation_id,p_reason);
        IF NOT outcome.ok THEN
          RAISE EXCEPTION 'suppression failed' USING ERRCODE='55000';
        END IF;
      END IF;
    END LOOP;
    IF p_action='hide_visit' THEN
      UPDATE public.merchant_discovery_contributions SET suppressed_at=COALESCE(suppressed_at,now()) WHERE id=c.id;
      PERFORM public.enqueue_merchant_discovery_projection_refresh(c.partner_id,'report_resolution');
    END IF;
  END IF;
  UPDATE public.merchant_verified_visit_reports SET
    status=CASE WHEN p_action='dismiss' THEN 'dismissed' ELSE 'actioned' END,
    resolved_at=now(),resolved_by=p_actor_id,
    resolution_note=p_action || ':' || p_reason || ':' || p_correlation_id
    WHERE id=p_report_id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.resolve_verified_visit_report(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_verified_visit_report(uuid,text,text,text,text) TO service_role;
-- Resolution is performed only through the transactional function.
REVOKE UPDATE ON public.merchant_verified_visit_reports FROM service_role;
NOTIFY pgrst, 'reload schema';
