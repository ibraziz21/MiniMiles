// Active deal templates + affordability helpers for the member home's
// denominated balance line (§2b) and "Use it today" deals rail (§2c).
// Same source/shape as app/vouchers/page.tsx's getAllTemplates — kept as its
// own module since a home-specific affordability sort isn't needed there.
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_PARTNER_FILTER } from "@/lib/akiba/hidden-partners";

export type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  partners: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  } | null;
};

export async function getActiveDeals(): Promise<VoucherTemplate[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("spend_voucher_templates")
    .select(`
      id, title, voucher_type, miles_cost, discount_percent, discount_cusd,
      applicable_category, retail_value_cusd,
      partners ( id, slug, name, image_url )
    `)
    .eq("active", true)
    .not("partner_id", "in", HIDDEN_PARTNER_FILTER)
    .order("miles_cost", { ascending: true });

  return ((data ?? []) as unknown[]).map((item) => {
    const d = item as Record<string, unknown>;
    const partners = Array.isArray(d.partners) ? (d.partners[0] ?? null) : d.partners;
    return { ...d, partners } as VoucherTemplate;
  });
}

/** Affordable-with-current-balance first, then the rest — both groups keep
 *  their existing miles_cost-ascending order (spec §2c ordering). */
export function sortByAffordability(templates: VoucherTemplate[], balance: number): VoucherTemplate[] {
  const affordable = templates.filter((t) => t.miles_cost <= balance);
  const notYet = templates.filter((t) => t.miles_cost > balance);
  return [...affordable, ...notYet];
}

/** Cheapest deal the user can already afford, or null if none. */
export function cheapestAffordable(templates: VoucherTemplate[], balance: number): VoucherTemplate | null {
  return templates.find((t) => t.miles_cost <= balance) ?? null;
}

/** Cheapest deal overall — used for the "{n} more to unlock" line when
 *  nothing is affordable yet. */
export function cheapestOverall(templates: VoucherTemplate[]): VoucherTemplate | null {
  return templates[0] ?? null;
}

export function dealLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "percent_off") return `${t.discount_percent ?? 0}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd ?? 0} off`;
  return "Free item";
}
