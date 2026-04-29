// lib/spendOrderPricing.ts

export type VoucherType = "free" | "percent_off" | "fixed_off";

export interface VoucherRules {
  voucher_type: VoucherType;
  discount_percent?: number | null;
  discount_cusd?: number | null;
  applicable_category?: string | null;
  /** When set, this voucher applies only to this specific product id. */
  linked_product_id?: string | null;
  /**
   * For 'free' type on a product-linked voucher — the covered retail value.
   * When set, the product is free up to this amount (i.e. full price covered).
   * When not set, falls back to max_item_value_cusd cap.
   */
  retail_value_cusd?: number | null;
  /** Only for 'free' type category/all vouchers — product must cost ≤ this. Default: 15 */
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
/**
 * Returns the discounted product price in cUSD.
 *
 * Scope enforcement (in priority order):
 *  1. If voucher has linked_product_id, it MUST match product_id exactly — otherwise no discount.
 *  2. If voucher has applicable_category, product category must match — otherwise no discount.
 *  3. No scope = applies to everything.
 */
export function applyVoucher(
  product_price_cusd: number,
  product_category: string | null | undefined,
  voucher: VoucherRules | null,
  product_id?: string | null,
): number {
  if (!voucher) return product_price_cusd;

  // ── Product-specific enforcement ─────────────────────────────────────────
  if (voucher.linked_product_id) {
    // Must have a product_id and it must match exactly
    if (!product_id || product_id !== voucher.linked_product_id) {
      return product_price_cusd;
    }
    // Product match confirmed — category is irrelevant for product-linked vouchers
  } else if (voucher.applicable_category && product_category) {
    // Category scope enforcement (only for non-product-linked vouchers)
    if (voucher.applicable_category.toLowerCase() !== product_category.toLowerCase()) {
      return product_price_cusd;
    }
  }

  switch (voucher.voucher_type) {
    case "free": {
      if (voucher.linked_product_id) {
        // Product-linked free voucher covers the full product price (100% free, pending delivery)
        return 0;
      }
      // Category/all free voucher: product must cost ≤ cap
      const maxVal = voucher.retail_value_cusd ?? voucher.max_item_value_cusd ?? 15;
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
  product_id?: string | null;
  city: string;
  voucher: VoucherRules | null;
}): OrderPricing {
  const { product_price_cusd, product_category, product_id, city, voucher } = params;
  const { fee_cusd, eta } = getDeliveryTier(city);
  const discounted = applyVoucher(product_price_cusd, product_category, voucher, product_id);
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
