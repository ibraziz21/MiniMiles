export type DeliveryInfo = { fee: number; eta: string };

const URBAN = ["nairobi", "mombasa"];
const TOWNS = [
  "kisumu", "nakuru", "eldoret", "thika", "ruiru", "machakos", "nyeri",
  "meru", "embu", "kitale", "malindi", "kilifi", "garissa", "kisii",
];

export function getDeliveryInfo(city: string): DeliveryInfo {
  const c = city.toLowerCase().trim();
  if (URBAN.includes(c)) return { fee: 3, eta: "1–2 days" };
  if (TOWNS.includes(c)) return { fee: 5, eta: "3–5 days" };
  return { fee: 5, eta: "3–5 days" };
}

export type VoucherForPricing = {
  voucher_type: "free" | "percent_off" | "fixed_off";
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  linked_product_id: string | null;
  retail_value_cusd: number | null;
};

const FREE_CAP = 15;

export function applyVoucher(
  price: number,
  category: string,
  productId: string,
  voucher: VoucherForPricing | null
): number {
  if (!voucher) return price;

  if (voucher.linked_product_id) {
    if (voucher.linked_product_id !== productId) return price;
    if (voucher.voucher_type === "free") return 0;
    if (voucher.voucher_type === "percent_off")
      return price * (1 - (voucher.discount_percent ?? 0) / 100);
    return Math.max(0, price - (voucher.discount_cusd ?? 0));
  }

  if (voucher.applicable_category) {
    if (voucher.applicable_category !== category) return price;
    const cap = voucher.retail_value_cusd ?? FREE_CAP;
    if (voucher.voucher_type === "free") return price <= cap ? 0 : price - cap;
    if (voucher.voucher_type === "percent_off")
      return price * (1 - (voucher.discount_percent ?? 0) / 100);
    return Math.max(0, price - (voucher.discount_cusd ?? 0));
  }

  if (voucher.voucher_type === "free")
    return price <= FREE_CAP ? 0 : price - FREE_CAP;
  if (voucher.voucher_type === "percent_off")
    return price * (1 - (voucher.discount_percent ?? 0) / 100);
  return Math.max(0, price - (voucher.discount_cusd ?? 0));
}

export function calculateOrder(
  price: number,
  category: string,
  productId: string,
  city: string,
  voucher: VoucherForPricing | null
) {
  const { fee: deliveryFee, eta } = getDeliveryInfo(city);
  const discountedPrice = applyVoucher(price, category, productId, voucher);
  const discount = price - discountedPrice;
  const total = discountedPrice + deliveryFee;
  return {
    originalPrice: price,
    discountedPrice,
    discount,
    deliveryFee,
    total,
    eta,
    totalKes: Math.round(total * 130),
  };
}

export function formatUSD(n: number) {
  return `$${n.toFixed(2)}`;
}

export function voucherLabel(v: VoucherForPricing): string {
  if (v.voucher_type === "free") return "Free item";
  if (v.voucher_type === "percent_off") return `${v.discount_percent}% off`;
  return `$${(v.discount_cusd ?? 0).toFixed(2)} off`;
}
