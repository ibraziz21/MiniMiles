import { createAdminClient } from "@/lib/supabase/admin";

type HelpfulRow = { contribution_id: string };

export async function getHelpfulVerifiedVisitIds(
  hubUserId: string,
  contributionIds: string[],
): Promise<string[]> {
  if (contributionIds.length === 0) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("merchant_verified_visit_helpful_reactions")
    .select("contribution_id")
    .eq("hub_user_id", hubUserId)
    .in("contribution_id", contributionIds);

  if (error) {
    console.error("[verified-visit-helpful] member lookup failed:", error.message);
    return [];
  }

  return ((data ?? []) as HelpfulRow[]).map((row) => row.contribution_id);
}

export async function isEligiblePublicVerifiedVisit(
  contributionId: string,
  merchantId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .rpc("eligible_public_merchant_visit_cards", { p_partner_id: merchantId })
    .eq("contribution_id", contributionId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[verified-visit-helpful] eligibility lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function markVerifiedVisitHelpful(
  hubUserId: string,
  contributionId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_verified_visit_helpful_reactions")
    .upsert(
      { hub_user_id: hubUserId, contribution_id: contributionId },
      { onConflict: "contribution_id,hub_user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`verified visit helpful insert failed: ${error.message}`);
}

export async function unmarkVerifiedVisitHelpful(
  hubUserId: string,
  contributionId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_verified_visit_helpful_reactions")
    .delete()
    .eq("hub_user_id", hubUserId)
    .eq("contribution_id", contributionId);
  if (error) throw new Error(`verified visit helpful delete failed: ${error.message}`);
}
