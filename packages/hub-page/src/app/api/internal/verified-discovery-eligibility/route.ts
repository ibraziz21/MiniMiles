// GET /api/internal/verified-discovery-eligibility?contributionId=...&photoId=...
// Operational tool (verified-discovery-market-readiness-hardening-spec.md
// §8.3: "verify whether a contribution/photo is currently public-eligible").
// Reuses the canonical eligibility functions directly rather than
// re-deriving the predicate — the same rule this whole hardening pass
// insists application code follow applies to its own tooling too.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAuthorized(request: Request): boolean {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET ?? "";
  return !!secret && request.headers.get("x-webhook-secret") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const contributionId = url.searchParams.get("contributionId");
  const photoId = url.searchParams.get("photoId");

  if (!contributionId && !photoId) {
    return NextResponse.json({ error: "Provide contributionId and/or photoId." }, { status: 400 });
  }
  if (contributionId && !UUID_PATTERN.test(contributionId)) {
    return NextResponse.json({ error: "Invalid contributionId." }, { status: 400 });
  }
  if (photoId && !UUID_PATTERN.test(photoId)) {
    return NextResponse.json({ error: "Invalid photoId." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result: { contributionId?: string; visitPublic?: boolean; photoId?: string; photoPublic?: boolean } = {};

  if (contributionId) {
    const { data, error } = await admin
      .rpc("eligible_public_merchant_visits")
      .eq("contribution_id", contributionId);
    if (error) {
      console.error("[verified-discovery-eligibility] visit lookup failed:", error.message);
      return NextResponse.json({ error: "Eligibility check is unavailable" }, { status: 503 });
    }
    result.contributionId = contributionId;
    result.visitPublic = (data ?? []).length > 0;
  }

  if (photoId) {
    const { data, error } = await admin
      .rpc("eligible_public_merchant_visit_photos")
      .eq("photo_id", photoId);
    if (error) {
      console.error("[verified-discovery-eligibility] photo lookup failed:", error.message);
      return NextResponse.json({ error: "Eligibility check is unavailable" }, { status: 503 });
    }
    result.photoId = photoId;
    result.photoPublic = (data ?? []).length > 0;
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
