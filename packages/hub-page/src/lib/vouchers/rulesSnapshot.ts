// Immutable-at-issuance rules-snapshot override — extracted from
// src/app/vouchers/[id]/page.tsx so the web detail page and the
// GET /api/v1/me/vouchers/:id route apply the exact same merge instead of
// each reimplementing it. `rules_snapshot` is a JSON blob captured on the
// issued_vouchers row at issuance time; any key present in it overrides the
// live spend_voucher_templates row, so a voucher keeps showing the deal
// terms that were true when it was issued even if the template/partner
// changes later. The raw snapshot object itself is never returned to a
// client — only this merged, derived result.
export type VoucherTypeLabel = "free" | "percent_off" | "fixed_off";

export type RulesSnapshotInputTemplate = {
  title: string;
  voucher_type: VoucherTypeLabel;
  discount_percent: number | null;
  discount_cusd: number | null;
  discount_kes: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  retail_value_kes?: number | null;
  maximum_discount_kes?: number | null;
  minimum_spend_kes?: number | null;
  terms_text?: string | null;
  linked_product_id?: string | null;
};

export type RulesSnapshotResult = {
  title: string;
  voucherType: VoucherTypeLabel;
  discountPercent: number | null;
  discountCusd: number | null;
  discountKes: number | null;
  applicableCategory: string | null;
  retailValueCusd: number | null;
  retailValueKes: number | null;
  maximumDiscountKes: number | null;
  minimumSpendKes: number | null;
  terms: string | null;
  linkedProductId: string | null;
};

function snapshotHas(snapshot: Record<string, unknown> | null, key: string): boolean {
  return snapshot !== null && Object.prototype.hasOwnProperty.call(snapshot, key);
}

function snapshotNumber(
  snapshot: Record<string, unknown> | null,
  key: string,
  fallback: number | null,
): number | null {
  if (!snapshotHas(snapshot, key)) return fallback;
  const value = snapshot?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function applyImmutableRulesSnapshot(
  template: RulesSnapshotInputTemplate,
  rulesSnapshot: unknown,
): RulesSnapshotResult {
  const snapshot =
    rulesSnapshot && typeof rulesSnapshot === "object" && !Array.isArray(rulesSnapshot)
      ? (rulesSnapshot as Record<string, unknown>)
      : null;

  const snapshotType =
    snapshot?.voucher_type === "percent" ? "percent_off" :
    snapshot?.voucher_type === "fixed" ? "fixed_off" :
    snapshot?.voucher_type === "free_product" ? "free" :
    snapshot?.voucher_type;

  return {
    title: typeof snapshot?.title === "string" ? snapshot.title : template.title,
    voucherType: typeof snapshotType === "string" ? (snapshotType as VoucherTypeLabel) : template.voucher_type,
    discountPercent: snapshotNumber(snapshot, "discount_percent", template.discount_percent),
    discountCusd: snapshotNumber(snapshot, "discount_cusd", template.discount_cusd),
    discountKes: snapshotNumber(snapshot, "discount_kes", template.discount_kes),
    applicableCategory: snapshotHas(snapshot, "applicable_category")
      ? typeof snapshot?.applicable_category === "string"
        ? snapshot.applicable_category
        : null
      : template.applicable_category,
    maximumDiscountKes: snapshotNumber(snapshot, "maximum_discount_kes", template.maximum_discount_kes ?? null),
    minimumSpendKes: snapshotNumber(snapshot, "minimum_spend_kes", template.minimum_spend_kes ?? null),
    terms: snapshotHas(snapshot, "terms_text") ? typeof snapshot?.terms_text === "string" ? snapshot.terms_text : null : template.terms_text ?? null,
    linkedProductId: snapshotHas(snapshot, "linked_product_id") ? typeof snapshot?.linked_product_id === "string" ? snapshot.linked_product_id : null : template.linked_product_id ?? null,
    retailValueKes: snapshotNumber(snapshot, "retail_value_kes", template.retail_value_kes ?? null),
    retailValueCusd: snapshotNumber(snapshot, "retail_value_cusd", template.retail_value_cusd),
  };
}

/**
 * Participant merchant IDs recorded on an issued voucher.
 *
 * Read from the snapshot and nowhere else. The allocation's current set is
 * explicitly the wrong source for an issued voucher: it may have been edited,
 * and the voucher was judged against what was named when it was claimed
 * (BDR-006 §4.2). Returns [] for a legacy voucher that carries no set, which
 * callers read as "single-merchant, use the template's partner".
 */
export function snapshotParticipantIds(rulesSnapshot: unknown): string[] {
  const snapshot =
    rulesSnapshot && typeof rulesSnapshot === "object" && !Array.isArray(rulesSnapshot)
      ? (rulesSnapshot as Record<string, unknown>)
      : null;
  const ids = snapshot?.eligible_merchant_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}
