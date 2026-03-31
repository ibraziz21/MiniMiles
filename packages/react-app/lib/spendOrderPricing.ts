// lib/spendOrderPricing.ts

export type VoucherType = "free" | "percent_off" | "fixed_off";

export interface VoucherRules {
  voucher_type: VoucherType;
  discount_percent?: number | null;
  discount_cusd?: number | null;
  applicable_category?: string | null;
  /** Only for 'free' type — product must cost ≤ this to qualify. Default: 15 */
  max_item_value_cusd?: number | null;
}

export interface DeliveryTier {
  fee_cusd: number;
  eta: string;
}

export interface OrderPricing {
  product_price_cusd: number;
  discounted_product_cusd: number;
  delivery_fee_cusd: number;
  total_cusd: number;
  total_kes: number;
  delivery_eta: string;
  voucher_applied: boolean;
}

const KES_RATE = 130;

// Cities that get the $3 urban rate
const URBAN_CITIES = new Set(["nairobi", "mombasa"]);

// Towns that explicitly get the $5 rate (same as rural, but named separately for ETAs)
const TOWN_CITIES = new Set([
  "kisumu", "nakuru", "eldoret", "thika", "nyeri",
  "kericho", "nanyuki", "malindi", "machakos", "kitale",
  "garissa", "isiolo", "meru", "embu", "kakamega",
]);

export function getDeliveryTier(city: string): DeliveryTier {
  const key = city.trim().toLowerCase();
  if (URBAN_CITIES.has(key)) return { fee_cusd: 3.0, eta: "1–2 days" };
  if (TOWN_CITIES.has(key)) return { fee_cusd: 5.0, eta: "3–5 days" };
  return { fee_cusd: 5.0, eta: "3–5 days" };
}

/**
 * Returns the discounted product price in cUSD.
 * Returns the original price unchanged if the voucher's category restriction
 * doesn't match the product category.
 */
export function applyVoucher(
  product_price_cusd: number,
  product_category: string | null | undefined,
  voucher: VoucherRules | null,
): number {
  if (!voucher) return product_price_cusd;

  // Only enforce category restriction when we actually know the product's category
  if (
    voucher.applicable_category &&
    product_category &&
    voucher.applicable_category.toLowerCase() !== product_category.toLowerCase()
  ) {
    return product_price_cusd;
  }

  switch (voucher.voucher_type) {
    case "free": {
      const maxVal = voucher.max_item_value_cusd ?? 15;
      return product_price_cusd <= maxVal ? 0 : product_price_cusd;
    }
    case "percent_off": {
      const pct = voucher.discount_percent ?? 0;
      return product_price_cusd * (1 - pct / 100);
    }
    case "fixed_off": {
      const fixed = Number(voucher.discount_cusd ?? 0);
      return Math.max(0, product_price_cusd - fixed);
    }
    default:
      return product_price_cusd;
  }
}

export function calculateOrderTotal(params: {
  product_price_cusd: number;
  product_category: string | null | undefined;
  city: string;
  voucher: VoucherRules | null;
}): OrderPricing {
  const { product_price_cusd, product_category, city, voucher } = params;
  const { fee_cusd, eta } = getDeliveryTier(city);
  const discounted = applyVoucher(product_price_cusd, product_category, voucher);
  // Round to avoid floating-point drift before on-chain amount comparison
  const total = Math.round((discounted + fee_cusd) * 1e6) / 1e6;

  return {
    product_price_cusd,
    discounted_product_cusd: discounted,
    delivery_fee_cusd: fee_cusd,
    total_cusd: total,
    total_kes: Math.round(total * KES_RATE),
    delivery_eta: eta,
    voucher_applied: voucher !== null && discounted < product_price_cusd,
  };
}
