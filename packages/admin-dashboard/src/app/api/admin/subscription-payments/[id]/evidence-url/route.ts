// POST /api/admin/subscription-payments/[id]/evidence-url
// Mints a short-lived signed URL (<= 5 min) for the private evidence object that
// belongs to this attempt. The browser never receives the Supabase service key;
// the signed URL is returned once and never logged or persisted.

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  EVIDENCE_URL_TTL_SECONDS,
  isUuid,
  SUBSCRIPTION_PAYMENT_VIEWS,
} from "@/lib/subscriptionPayments";

// Allow-list of content types we will hand back for preview/download.
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid payment attempt id" }, { status: 400 });
  }

  const { data: detail, error } = await supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.detail)
    .select("evidence_bucket, evidence_path, evidence_content_type")
    .eq("payment_attempt_id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[admin/subscription-payments] evidence lookup error:", error.message);
    return NextResponse.json({ error: "Failed to load payment attempt" }, { status: 500 });
  }
  if (!detail) {
    return NextResponse.json({ error: "Payment attempt not found" }, { status: 404 });
  }
  if (!detail.evidence_bucket || !detail.evidence_path) {
    return NextResponse.json({ error: "No evidence was supplied for this attempt" }, { status: 404 });
  }
  if (
    detail.evidence_content_type &&
    !ALLOWED_CONTENT_TYPES.has(String(detail.evidence_content_type))
  ) {
    return NextResponse.json(
      { error: "Evidence file type is not supported for preview" },
      { status: 415 },
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(String(detail.evidence_bucket))
    .createSignedUrl(String(detail.evidence_path), EVIDENCE_URL_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    console.error("[admin/subscription-payments] sign error:", signErr?.message);
    return NextResponse.json({ error: "Could not sign evidence URL" }, { status: 502 });
  }

  return NextResponse.json(
    {
      url: signed.signedUrl,
      expiresInSeconds: EVIDENCE_URL_TTL_SECONDS,
      contentType: detail.evidence_content_type ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
