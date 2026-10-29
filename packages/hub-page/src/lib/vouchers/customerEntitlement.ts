import { applyImmutableRulesSnapshot, snapshotParticipantIds, type RulesSnapshotInputTemplate } from "./rulesSnapshot";

export type EntitlementMerchant = { id: string; name: string; slug: string; imageUrl: string | null };
export type CustomerVoucherEntitlement = {
  title: string;
  voucherType: string;
  discountPercent: number | null;
  discountKes: number | null;
  discountCusd: number | null;
  retailValueCusd: number | null;
  retailValueKes: number | null;
  maximumDiscountKes: number | null;
  minimumSpendKes: number | null;
  terms: string | null;
  applicableCategory: string | null;
  linkedProductId: string | null;
  redemptionSchedule: { days: number[]; timezone: string; startDate?: string; endDate?: string } | null;
  merchants: EntitlementMerchant[];
  merchantCount: number;
  merchantsIncomplete: boolean;
  timing: { kind: "offer"; claimDeadline: string; validForSeconds: number | null }
    | { kind: "issued"; expiresAt: string | null };
};

type OfferInput = {
  title: string; voucherType: string; discountPercent: number | null; discountKes: number | null;
  maximumDiscountKes: number | null; minimumSpendKes: number; terms: string | null;
  claimEndsAt: string; voucherValiditySeconds?: number | null;
  redemptionSchedule?: CustomerVoucherEntitlement["redemptionSchedule"];
  merchants?: EntitlementMerchant[];
  merchant?: { name: string; slug: string; imageUrl: string | null };
};

export function entitlementFromOffer(offer: OfferInput): CustomerVoucherEntitlement {
  const merchants = offer.merchants?.length ? offer.merchants : offer.merchant ? [{ id: "", ...offer.merchant }] : [];
  return {
    title: offer.title, voucherType: offer.voucherType, discountPercent: offer.discountPercent,
    discountKes: offer.discountKes, discountCusd: null, retailValueCusd: null, retailValueKes: null, maximumDiscountKes: offer.maximumDiscountKes,
    minimumSpendKes: offer.minimumSpendKes, terms: offer.terms, applicableCategory: null, linkedProductId: null,
    redemptionSchedule: offer.redemptionSchedule ?? null, merchants, merchantCount: merchants.length,
    merchantsIncomplete: false,
    timing: { kind: "offer", claimDeadline: offer.claimEndsAt, validForSeconds: offer.voucherValiditySeconds ?? null },
  };
}

/** Issued facts always merge the immutable snapshot before any live fallback. */
export function entitlementFromIssued(input: {
  template?: Partial<RulesSnapshotInputTemplate> | null;
  snapshot: unknown;
  expiresAt: string | null;
  merchants: EntitlementMerchant[];
  primaryMerchant?: EntitlementMerchant | null;
}): CustomerVoucherEntitlement {
  const t = input.template;
  const merged = applyImmutableRulesSnapshot({
    title: t?.title ?? "Voucher", voucher_type: t?.voucher_type ?? "free",
    discount_percent: t?.discount_percent ?? null, discount_kes: t?.discount_kes ?? null,
    discount_cusd: t?.discount_cusd ?? null, retail_value_cusd: t?.retail_value_cusd ?? null,
    applicable_category: t?.applicable_category ?? null, maximum_discount_kes: t?.maximum_discount_kes ?? null,
    minimum_spend_kes: t?.minimum_spend_kes ?? null, terms_text: t?.terms_text ?? null,
    linked_product_id: t?.linked_product_id ?? null, retail_value_kes: t?.retail_value_kes ?? null,
  }, input.snapshot);
  const ids = snapshotParticipantIds(input.snapshot);
  const merchants = ids.length ? input.merchants.filter(m => ids.includes(m.id)) : input.primaryMerchant ? [input.primaryMerchant] : [];
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot as Record<string, unknown> : null;
  const schedule = snapshot?.redemption_schedule as CustomerVoucherEntitlement["redemptionSchedule"];
  return {
    title: merged.title, voucherType: merged.voucherType, discountPercent: merged.discountPercent,
    discountKes: merged.discountKes, discountCusd: merged.discountCusd, retailValueCusd: merged.retailValueCusd, retailValueKes: merged.retailValueKes, maximumDiscountKes: merged.maximumDiscountKes,
    minimumSpendKes: merged.minimumSpendKes, terms: merged.terms, applicableCategory: merged.applicableCategory,
    linkedProductId: merged.linkedProductId,
    redemptionSchedule: schedule && Array.isArray(schedule.days) && typeof schedule.timezone === "string" ? schedule : null,
    merchants, merchantCount: ids.length || merchants.length, merchantsIncomplete: ids.length > merchants.length,
    timing: { kind: "issued", expiresAt: input.expiresAt },
  };
}

const kes = (value: number) => `KES ${value.toLocaleString("en-KE")}`;
export function entitlementBenefit(e: CustomerVoucherEntitlement): string {
  if (e.voucherType === "percent_off") {
    if (e.discountPercent == null) return "Benefit details unavailable";
    return `${e.discountPercent}% off${e.maximumDiscountKes != null ? `, up to ${kes(e.maximumDiscountKes)}` : ""}`;
  }
  if (e.voucherType === "fixed_off") return e.discountKes != null ? `${kes(e.discountKes)} off`
    : e.discountCusd != null ? `$${e.discountCusd.toFixed(2)} off` : "Benefit details unavailable";
  return e.retailValueKes != null ? `Free item (up to ${kes(e.retailValueKes)})`
    : e.retailValueCusd != null ? `Free (up to $${e.retailValueCusd.toFixed(2)})` : "Free item";
}

export function entitlementScope(e: CustomerVoucherEntitlement): string {
  return e.merchantCount > 1 ? `Use once at any of ${e.merchantCount} merchants`
    : e.merchants[0] ? `Use once at ${e.merchants[0].name}` : "Merchant details unavailable";
}

export function entitlementDates(e: CustomerVoucherEntitlement): string[] {
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("en-KE", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi",
    }) + " (EAT)" : "Date unavailable";
  };
  if (e.timing.kind === "issued") return [e.timing.expiresAt ? `Use by ${date(e.timing.expiresAt)}` : "No expiry recorded"];
  const seconds = e.timing.validForSeconds;
  const amount = seconds && seconds > 0 ? seconds % 86400 === 0 ? `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`
    : seconds % 3600 === 0 ? `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}` : seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds` : null;
  return [`Claim by ${date(e.timing.claimDeadline)}`, amount ? `Valid for ${e.redemptionSchedule?.endDate ? "up to " : ""}${amount} after claiming${e.redemptionSchedule?.endDate ? ", within the event dates" : ""}` : "Validity details unavailable"];
}

export function entitlementConditions(e: CustomerVoucherEntitlement): string[] {
  return [
    e.minimumSpendKes != null && e.minimumSpendKes > 0 ? `Minimum purchase ${kes(e.minimumSpendKes)}` : null,
    e.applicableCategory ? `On ${e.applicableCategory.replaceAll("_", " ")}` : null,
    e.linkedProductId ? "Selected items only" : null,
    e.redemptionSchedule?.startDate && e.redemptionSchedule.endDate
      ? `Use only ${new Date(e.redemptionSchedule.startDate + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}–${new Date(e.redemptionSchedule.endDate + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} (${e.redemptionSchedule.timezone})` : null,
    e.redemptionSchedule ? `Use on ${e.redemptionSchedule.days.map(day => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")} (${e.redemptionSchedule.timezone})` : null,
  ].filter((value): value is string => !!value);
}
