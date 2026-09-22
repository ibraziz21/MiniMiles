// Save/follow a merchant (discovery-blueprint.md §6/§8, Phase 2) — schema
// and API only this pass, backed by hub_user_saved_merchants
// (supabase/migrations/074_hub_user_saved_merchants.sql). No UI consumes
// this yet.
import { createAdminClient } from "@/lib/supabase/admin";

export async function isMerchantSaved(userId: string, merchantId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hub_user_saved_merchants")
    .select("id")
    .eq("hub_user_id", userId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  return !!data;
}

export async function saveMerchant(userId: string, merchantId: string): Promise<void> {
  const admin = createAdminClient();
  // Upsert on the table's own unique constraint — saving an already-saved
  // merchant is a no-op, not a conflict error.
  const { error } = await admin
    .from("hub_user_saved_merchants")
    .upsert({ hub_user_id: userId, merchant_id: merchantId }, { onConflict: "hub_user_id,merchant_id" });
  if (error) throw error;
}

export async function unsaveMerchant(userId: string, merchantId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("hub_user_saved_merchants")
    .delete()
    .eq("hub_user_id", userId)
    .eq("merchant_id", merchantId);
  if (error) throw error;
}

export type SavedMerchantSummary = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  savedAt: string;
};

/**
 * Direct, limited-column partners join for an internal read — same pattern
 * buildLimitedTimeSection (lib/home/feed.ts) already uses rather than
 * calling the canonical get_public_merchant RPC once per saved row.
 * Excludes merchants that are no longer active, without deleting the saved
 * row itself (the save/follow relationship is the member's own history).
 */
export async function listSavedMerchants(userId: string): Promise<SavedMerchantSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_saved_merchants")
    .select(
      `created_at,
       partners!inner ( id, slug, name, image_url, status )`
    )
    .eq("hub_user_id", userId)
    .eq("partners.status", "active")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[savedMerchants] list query failed:", error.message);
    return [];
  }

  type Partner = { id: string; slug: string; name: string; image_url: string | null };
  type Row = { created_at: string; partners: Partner | Partner[] };

  return ((data ?? []) as unknown as Row[]).flatMap((row) => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    if (!partner) return [];
    return [{ id: partner.id, slug: partner.slug, name: partner.name, logoUrl: partner.image_url, savedAt: row.created_at }];
  });
}
