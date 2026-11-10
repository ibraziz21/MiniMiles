-- The purchase RPC has search_path=public, while production's pgcrypto is
-- installed in extensions. Qualify its digest call instead of widening the
-- SECURITY DEFINER search path. Discover the extension schema so replay also
-- works in databases that installed pgcrypto in public.
-- Patch the deployed definition to preserve notification/identity changes
-- supplied by later migrations; CREATE OR REPLACE retains its owner and ACL.
DO $migration$
DECLARE
  v_schema text;
  v_definition text;
  v_qualified_call text;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pgcrypto';
  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto must be installed before repairing voucher purchases';
  END IF;

  SELECT pg_get_functiondef(
    'public.reserve_voucher_purchase(uuid,text,text[],text,uuid,uuid,text,integer,text,text,text,uuid,boolean,numeric)'::regprocedure
  ) INTO v_definition;
  v_qualified_call := format('encode(%I.digest(', v_schema);

  IF strpos(v_definition, 'encode(digest(')>0 THEN
    EXECUTE replace(v_definition, 'encode(digest(', v_qualified_call);
  ELSIF strpos(v_definition, v_qualified_call)=0 THEN
    RAISE EXCEPTION 'Unexpected reserve_voucher_purchase definition; review digest call manually';
  END IF;
END;
$migration$;
