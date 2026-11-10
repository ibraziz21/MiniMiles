import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isTrustedMutationRequest } from "@/lib/requestSecurity";
import { writeAdminAuditLog } from "@/lib/audit";
import {
  EVIDENCE_BUCKET,
  evidenceExtension,
} from "@/lib/reimbursementEvidence";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req))
    return NextResponse.json(
      { error: "Cross-site request rejected" },
      { status: 403 }
    );
  const session = await requireAdminSession("voucher_settlements.mark_paid");
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.NODE_ENV === "production" && !adminIdForWrite(session))
    return NextResponse.json(
      { error: "A named admin is required" },
      { status: 403 }
    );
  if (Number(req.headers.get("content-length")) > 11 * 1024 * 1024)
    return NextResponse.json(
      { error: "Receipt is too large" },
      { status: 413 }
    );
  const form = await req.formData().catch(() => null),
    id = form?.get("batchId"),
    file = form?.get("file");
  if (
    typeof id !== "string" ||
    !uuid.test(id) ||
    !file ||
    typeof file === "string" ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024
  )
    return NextResponse.json(
      { error: "Choose a PDF, PNG or JPG receipt up to 10 MB" },
      { status: 400 }
    );
  const batch = await supabase
    .from("voucher_funding_reimbursement_batches")
    .select("id,state")
    .eq("id", id)
    .maybeSingle();
  if (batch.error)
    return NextResponse.json(
      { error: "Payment batch unavailable" },
      { status: 503 }
    );
  if (batch.data?.state !== "submitted")
    return NextResponse.json(
      { error: "Receipts can only be added to submitted payments" },
      { status: 409 }
    );
  const bytes = new Uint8Array(await file.arrayBuffer()),
    extension = evidenceExtension(bytes, file.type);
  if (!extension)
    return NextResponse.json(
      { error: "Receipt contents do not match a supported file type" },
      { status: 415 }
    );
  const path = `${id}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploaded.error)
    return NextResponse.json(
      { error: "Receipt upload unavailable. Check Storage setup." },
      { status: 503 }
    );
  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_reimbursement.evidence_uploaded",
    targetType: "voucher_reimbursement_batch",
    targetId: id,
  });
  return NextResponse.json(
    { evidenceRef: `${EVIDENCE_BUCKET}/${path}` },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}
export async function GET(req: Request) {
  const session = await requireAdminSession("voucher_settlements.read");
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("batchId");
  if (!id || !uuid.test(id))
    return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
  const batch = await supabase
    .from("voucher_funding_reimbursement_batches")
    .select("payment_evidence_ref")
    .eq("id", id)
    .maybeSingle();
  const prefix = `${EVIDENCE_BUCKET}/${id}/`,
    ref = batch.data?.payment_evidence_ref;
  if (
    batch.error ||
    typeof ref !== "string" ||
    !ref.startsWith(prefix) ||
    !new RegExp(
      `^${EVIDENCE_BUCKET}/${id}/[0-9a-f-]+\\.(pdf|png|jpg)$`,
      "i"
    ).test(ref)
  )
    return NextResponse.json(
      { error: "No uploaded receipt is linked to this payment" },
      { status: 404 }
    );
  const signed = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(ref.slice(EVIDENCE_BUCKET.length + 1), 300);
  if (signed.error || !signed.data?.signedUrl)
    return NextResponse.json({ error: "Receipt unavailable" }, { status: 503 });
  return NextResponse.redirect(signed.data.signedUrl, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
