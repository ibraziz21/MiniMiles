import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberVerifiedVisitSummary } from "./types";

type PhotoRow = { moderation_status: string };

export function summarizeMemberPhotoState(
  photos: PhotoRow[],
): MemberVerifiedVisitSummary["photoState"] {
  if (photos.length === 0) return "none";
  if (photos.some((photo) => photo.moderation_status === "approved")) return "approved";
  if (photos.some((photo) => ["uploading", "processing", "pending"].includes(photo.moderation_status))) {
    return "under_review";
  }
  return "not_approved";
}

/**
 * Returns the signed-in member's latest private contribution confirmation for
 * this merchant. It is deliberately separate from the public merchant RPC:
 * raw individual contributions must never enter an anonymous response.
 */
export async function getMemberVerifiedVisitSummary(
  hubUserId: string,
  merchantId: string,
): Promise<MemberVerifiedVisitSummary | null> {
  const admin = createAdminClient();
  const { data: contribution, error } = await admin
    .from("merchant_discovery_contributions")
    .select("id, submitted_at, would_recommend")
    .eq("hub_user_id", hubUserId)
    .eq("partner_id", merchantId)
    .is("withdrawn_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[merchant-member-visit] contribution lookup failed:", error.message);
    return null;
  }
  if (!contribution) return null;

  const { data: photos, error: photosError } = await admin
    .from("merchant_visit_photos")
    .select("moderation_status")
    .eq("contribution_id", contribution.id)
    .eq("hub_user_id", hubUserId)
    .is("withdrawn_at", null);

  if (photosError) {
    console.error("[merchant-member-visit] photo status lookup failed:", photosError.message);
  }

  return {
    id: contribution.id,
    submittedAt: contribution.submitted_at,
    recommendation:
      contribution.would_recommend === true
        ? "recommended"
        : contribution.would_recommend === false
          ? "not_recommended"
          : "skipped",
    photoState: summarizeMemberPhotoState((photos ?? []) as PhotoRow[]),
  };
}

/**
 * Read-only eligibility check for the merchant-profile CTA. An open,
 * unexpired request is created only from verified earning evidence, so the
 * page never advertises contribution to an arbitrary visitor.
 */
export async function hasOpenMerchantContributionRequest(
  hubUserId: string,
  merchantId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("discovery_contribution_requests")
    .select("id")
    .eq("hub_user_id", hubUserId)
    .eq("partner_id", merchantId)
    .eq("state", "open")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[merchant-member-visit] contribution opportunity lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}
