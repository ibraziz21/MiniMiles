// Save/follow a merchant (discovery-blueprint.md §6/§8), backed by
// hub_user_saved_merchants (supabase/migrations/074_hub_user_saved_merchants.sql).
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

/**
 * Batch "which of these merchant ids does the member have saved" check —
 * the GET /api/v1/me/merchant-state self-overlay's saved-state source, used
 * instead of calling isMerchantSaved once per directory-page merchant.
 */
export async function listSavedMerchantIds(userId: string, merchantIds: string[]): Promise<Set<string>> {
  if (merchantIds.length === 0) return new Set();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_saved_merchants")
    .select("merchant_id")
    .eq("hub_user_id", userId)
    .in("merchant_id", merchantIds);
  if (error) {
    console.error("[savedMerchants] batch saved-state query failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row: { merchant_id: string }) => row.merchant_id));
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
  bannerUrl: string | null;
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
       partners!inner (
         id, slug, name, image_url, status
       )`
    )
    .eq("hub_user_id", userId)
    .eq("partners.status", "active")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[savedMerchants] list query failed:", error.message);
    return [];
  }

  type Partner = {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  };
  type Row = { created_at: string; partners: Partner | Partner[] };

  const saved = ((data ?? []) as unknown as Row[]).flatMap((row) => {
    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    if (!partner) return [];
    return [{
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      logoUrl: partner.image_url,
      bannerUrl: null,
      savedAt: row.created_at,
    }];
  });

  if (saved.length === 0) return saved;

  const partnerIds = saved.map((merchant) => merchant.id);

  // Merchant Dashboard stores the canonical logo in partner_settings.logo_url;
  // partners.image_url is only a legacy fallback. Banner support arrived later,
  // so fetch it independently: a deployment missing banner_url must never stop
  // the already-supported merchant logo from rendering.
  const [logoResult, bannerResult] = await Promise.all([
    admin
      .from("partner_settings")
      .select("partner_id, logo_url")
      .in("partner_id", partnerIds),
    admin
      .from("partner_settings")
      .select("partner_id, banner_url")
      .in("partner_id", partnerIds),
  ]);

  if (logoResult.error) {
    console.warn("[savedMerchants] logo query failed; using legacy partner images:", logoResult.error.message);
  }
  if (bannerResult.error) {
    console.warn("[savedMerchants] banner query failed; continuing without banners:", bannerResult.error.message);
  }

  const logoByPartner = new Map(
    ((logoResult.data ?? []) as Array<{ partner_id: string; logo_url: string | null }>).map((row) => [row.partner_id, row.logo_url])
  );
  const bannerByPartner = new Map(
    ((bannerResult.data ?? []) as Array<{ partner_id: string; banner_url: string | null }>).map((row) => [row.partner_id, row.banner_url])
  );

  return saved.map((merchant) => ({
    ...merchant,
    logoUrl: logoByPartner.get(merchant.id) ?? merchant.logoUrl,
    bannerUrl: bannerByPartner.get(merchant.id) ?? null,
  }));
}
