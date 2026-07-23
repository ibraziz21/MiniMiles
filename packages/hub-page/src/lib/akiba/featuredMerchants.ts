// Featured merchants — extracted from app/page.tsx so VisitorLanding (social
// proof row, spec §3) can reuse it without duplicating the query.
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_PARTNER_FILTER } from "@/lib/akiba/hidden-partners";

export type FeaturedMerchant = {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
};

export async function getFeaturedMerchants(): Promise<FeaturedMerchant[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("partners")
      .select("id, slug, name, image_url, partner_settings!inner(store_active, logo_url)")
      .eq("partner_settings.store_active", true)
      .not("id", "in", HIDDEN_PARTNER_FILTER)
      .limit(4);
    return (data ?? []).map((p) => {
      const s = Array.isArray(p.partner_settings) ? p.partner_settings[0] : p.partner_settings;
      return { id: p.id, slug: p.slug, name: p.name, image_url: s?.logo_url ?? p.image_url };
    });
  } catch {
    return [];
  }
}
