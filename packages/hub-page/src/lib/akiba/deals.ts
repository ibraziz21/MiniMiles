// Voucher template shape + label formatting shared across surfaces that
// show a voucher's discount as plain text. The home-redesign (home-redesign-
// spec.md) retired this module's old affordability-ordering helpers and its
// own query — home's merchant rails and "current offer value" ordering now
// come from the directory (`src/lib/home/feed.ts`), not a standalone
// unfiltered deals query. `dealLabel`/`VoucherTemplate` remain because
// `feed.ts` reuses the exact same label formatting for a merchant's top
// offer, rather than duplicating it.
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

export function dealLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "percent_off") return `${t.discount_percent ?? 0}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd ?? 0} off`;
  return "Free item";
}
