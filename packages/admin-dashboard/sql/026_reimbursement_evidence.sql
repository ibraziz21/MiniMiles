BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('voucher-reimbursement-evidence','voucher-reimbursement-evidence',false,10485760,ARRAY['application/pdf','image/png','image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
COMMIT;
