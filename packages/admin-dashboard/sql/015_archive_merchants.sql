-- Removal preserves all merchant financial and operational history.
CREATE OR REPLACE FUNCTION public.admin_archive_merchant(
  p_partner_id uuid, p_admin_id uuid, p_confirmation_name text, p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_partner public.partners%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
    RETURN 'INVALID_REASON';
  END IF;
  SELECT * INTO v_partner FROM public.partners WHERE id = p_partner_id AND type = 'merchant' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF trim(coalesce(p_confirmation_name, '')) <> v_partner.name THEN RETURN 'NAME_MISMATCH'; END IF;
  IF v_partner.status = 'archived' THEN RETURN 'ALREADY_ARCHIVED'; END IF;
  UPDATE public.partners SET status = 'archived', archived_at = now(), updated_at = now()
    WHERE id = p_partner_id;
  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_type, target_id, metadata)
    VALUES(p_admin_id, 'merchant.archived', 'merchant', p_partner_id::text,
      jsonb_build_object('name', v_partner.name, 'previous_status', v_partner.status, 'reason', trim(p_reason)));
  RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_archive_merchant(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_merchant(uuid, uuid, text, text) TO service_role;
