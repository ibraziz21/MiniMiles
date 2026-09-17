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

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Centralizes `$X.XX`-style formatting — every voucher-price surface
 *  (VoucherTabs, VoucherDetailView, VoucherCard, this file's own dealLabel)
 *  previously hand-rolled its own `` `$${n.toFixed(2)}` `` independently. */
export function formatUSD(amount: number): string {
  return usdFormatter.format(amount);
}

export function dealLabel(t: Pick<VoucherTemplate, "voucher_type" | "discount_percent" | "discount_cusd" | "retail_value_cusd">): string {
  if (t.voucher_type === "percent_off") return `${t.discount_percent ?? 0}% off`;
  if (t.voucher_type === "fixed_off") return `${formatUSD(t.discount_cusd ?? 0)} off`;
  return t.retail_value_cusd ? `Free (up to ${formatUSD(t.retail_value_cusd)})` : "Free item";
}
