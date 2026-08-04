// Thin wrapper around the get_or_create_referral_code RPC
// (053_referral_system.sql) — one stable, random code per Hub user.
import { createAdminClient } from "@/lib/supabase/admin";

export async function getOrCreateReferralCode(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_or_create_referral_code", { p_user_id: userId });
  if (error) {
    console.error("[referralCode] get_or_create_referral_code failed:", error.message);
    return null;
  }
  return typeof data === "string" ? data : null;
}
