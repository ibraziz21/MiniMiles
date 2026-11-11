-- Isolated schema contract for 023_funding_submit_publish.sql.
-- Run in a disposable, empty PostgreSQL database, never the Platform database.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE voucher_funding_programs(id uuid PRIMARY KEY,state text DEFAULT 'draft',starts_at timestamptz DEFAULT now()-interval '1 day',approval_revision integer DEFAULT 0,version integer DEFAULT 1,updated_at timestamptz,approved_by uuid,approved_at timestamptz,approval_reason text);
CREATE TABLE voucher_funding_allocations(id uuid PRIMARY KEY,program_id uuid,voucher_template_id uuid,state text DEFAULT 'draft',claim_starts_at timestamptz DEFAULT now()-interval '1 day',version integer DEFAULT 1,updated_at timestamptz);
CREATE TABLE voucher_claims(allocation_id uuid);
CREATE TABLE spend_voucher_templates(id uuid PRIMARY KEY,active boolean DEFAULT false,lifecycle_state text DEFAULT 'draft',published_at timestamptz,updated_at timestamptz);
CREATE TABLE audit_logs(actor_id uuid,actor_type text,entity_type text,entity_id uuid,action text,after jsonb,metadata jsonb);
CREATE TABLE test_readiness(merchant_name text,reason text,ready boolean);
CREATE FUNCTION voucher_allocation_merchant_readiness(uuid) RETURNS SETOF test_readiness LANGUAGE sql AS 'SELECT * FROM test_readiness';
\ir ../023_funding_submit_publish.sql
DO $$
DECLARE f uuid:='11111111-1111-4111-8111-111111111111'; a uuid:='22222222-2222-4222-8222-222222222222'; t uuid:='33333333-3333-4333-8333-333333333333'; actor uuid:='44444444-4444-4444-8444-444444444444';
BEGIN
 INSERT INTO voucher_funding_programs(id)VALUES(f);
 BEGIN
  PERFORM transition_voucher_funding_program_atomic(f,'publish',actor,null,0);
  RAISE EXCEPTION 'Draft fund published';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT LIKE 'PROGRAM_INVALID_STATE_TRANSITION%' THEN RAISE; END IF; END;
 PERFORM transition_voucher_funding_program_atomic(f,'submit',actor,null,null);
 BEGIN
  PERFORM transition_voucher_funding_program_atomic(f,'publish',actor,null,99);
  RAISE EXCEPTION 'Stale fund revision published';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM <> 'PROGRAM_APPROVAL_REVISION_MISMATCH' THEN RAISE; END IF; END;
 PERFORM transition_voucher_funding_program_atomic(f,'publish',actor,null,0);
 IF (SELECT state FROM voucher_funding_programs WHERE id=f)<>'active' THEN RAISE EXCEPTION 'Fund did not publish directly'; END IF;
 INSERT INTO spend_voucher_templates(id)VALUES(t);
 INSERT INTO voucher_funding_allocations(id,program_id,voucher_template_id)VALUES(a,f,t);
 PERFORM transition_voucher_funding_allocation_atomic(a,'submit',actor,null);
 INSERT INTO test_readiness VALUES('Fixture merchant','subscription inactive',false);
 BEGIN
  PERFORM transition_voucher_funding_allocation_atomic(a,'publish',actor,null);
  RAISE EXCEPTION 'Unready merchant published';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT LIKE 'MERCHANT_NOT_READY%' THEN RAISE; END IF; END;
 IF (SELECT state FROM voucher_funding_allocations WHERE id=a)<>'pending_approval' OR (SELECT active FROM spend_voucher_templates WHERE id=t) THEN RAISE EXCEPTION 'Failed publish leaked state'; END IF;
 UPDATE test_readiness SET ready=true;
 PERFORM transition_voucher_funding_allocation_atomic(a,'publish',actor,null);
 IF (SELECT state FROM voucher_funding_allocations WHERE id=a)<>'active' OR NOT (SELECT active FROM spend_voucher_templates WHERE id=t) THEN RAISE EXCEPTION 'Allocation/template did not publish atomically'; END IF;
 IF (SELECT count(*) FROM audit_logs WHERE action IN('program.publish','allocation.publish'))<>2 THEN RAISE EXCEPTION 'Missing publication audit'; END IF;
 UPDATE voucher_funding_programs SET state='approved',starts_at=now()+interval '1 day' WHERE id=f;
 PERFORM transition_voucher_funding_program_atomic(f,'publish',actor,null,0);
 IF (SELECT state FROM voucher_funding_programs WHERE id=f)<>'scheduled' THEN RAISE EXCEPTION 'Legacy approved fund cannot schedule'; END IF;
 RAISE NOTICE 'Submit → Publish guards, rollback, template and audit checks passed';
END; $$;
