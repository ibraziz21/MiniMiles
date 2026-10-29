import { entitlementFromIssued, type CustomerVoucherEntitlement } from "./customerEntitlement";
import type { VoucherTypeLabel } from "./rulesSnapshot";
// Member-owned voucher listing with status filtering and cursor pagination
// — genuinely new capability (hub-mobile-app-migration-plan.md: "Replace
// raw join rows with stable voucher summaries"). No existing route does
// this; /api/shop/vouchers/my fetches everything unbounded. Mirrors the
// base64url JSON-token + scope-hash cursor algorithm already proven in
// src/lib/merchants/queries.ts (not imported — that module's CursorToken
// shape is merchant-specific), and the same self_or_verified_wallet
// ownership filter every myVouchers.ts function and /api/shop/vouchers/my
// already use.
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { snapshotParticipantIds } from "@/lib/vouchers/rulesSnapshot";
import { resolveSnapshotParticipants } from "@/lib/vouchers/fundedOfferMerchants.server";
import type { MerchantSummary } from "@/components/vouchers/FundedOfferCard";
import { resolveOwnedVoucherStatus } from "@/lib/vouchers/ownedVoucherStatus";

export class InvalidOwnedVoucherCursorError extends Error {
  constructor() {
    super("invalid_owned_voucher_cursor");
    this.name = "InvalidOwnedVoucherCursorError";
  }
}

export class OwnedVouchersUnavailableError extends Error {
  constructor() {
    super("owned_vouchers_unavailable");
    this.name = "OwnedVouchersUnavailableError";
  }
}

export type OwnedVoucherStatusFilter = "active" | "redeemed" | "expired";

/**
 * No existing precedent dictates this mapping — a reasonable default
 * (matches getOwnedVoucherPreviews's existing "owned & usable" grouping for
 * `active`), flagged for product review rather than assumed correct forever.
 */
const STATUS_DB_VALUES: Record<OwnedVoucherStatusFilter, string[]> = {
  active: ["issued", "pending", "claiming"],
  redeemed: ["redeemed"],
  expired: ["expired", "void"],
};

export type OwnedVoucherSummary = {
  entitlement: CustomerVoucherEntitlement;
  id: string;
  status: string;
  title: string;
  voucherType: string;
  milesCost: number;
  discountPercent: number | null;
  discountCusd: number | null;
  retailValueCusd: number | null;
  merchantName: string | null;
  merchantSlug: string | null;
  merchantLogoUrl: string | null;
  /**
   * Every merchant this voucher may be redeemed at, from its claim-time
   * snapshot — not the allocation's current set, which may have been edited
   * since (BDR-006 §4.2). Empty for a legacy single-merchant voucher, whose
   * merchant is the merchantName/Slug above.
   */
  participantMerchants: MerchantSummary[];
  /**
   * How many merchants the snapshot named. Always the snapshot's count, even
   * when a profile could not be resolved, so an archived partner cannot
   * shrink the entitlement on screen.
   */
  participantCount: number;
  /** True when at least one named merchant's details could not be loaded. */
  participantsIncomplete: boolean;
  programName: string | null;
  createdAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
};

type CursorToken = { v: 1; createdAt: string; id: string; scope: string };

function cursorScope(userId: string, status: OwnedVoucherStatusFilter | undefined): string {
  return createHash("sha256")
    .update(JSON.stringify({ userId, status: status ?? null }))
    .digest("base64url")
    .slice(0, 16);
}

function encodeCursor(token: CursorToken): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined, expectedScope: string): CursorToken | null {
  if (!cursor) return null;
  if (cursor.length > 2048) throw new InvalidOwnedVoucherCursorError();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      parsed?.v === 1 &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      parsed.scope === expectedScope
    ) {
      return parsed as CursorToken;
    }
  } catch {
    throw new InvalidOwnedVoucherCursorError();
  }
  throw new InvalidOwnedVoucherCursorError();
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type RawTemplate = {
  title: string;
  voucher_type: VoucherTypeLabel;
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  discount_kes?: number | null;
  maximum_discount_kes?: number | null;
  minimum_spend_kes?: number | null;
  terms_text?: string | null;
  applicable_category?: string | null;
  linked_product_id?: string | null;
  retail_value_cusd: number | null;
  retail_value_kes?: number | null;
  partners:
    | { name: string; slug: string; image_url: string | null }
    | Array<{ name: string; slug: string; image_url: string | null }>
    | null;
};

type RawOwnedVoucherRow = {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  voucher_redemptions?: { merchant_id: string | null }[];
  rules_snapshot?: unknown;
  spend_voucher_templates: RawTemplate | RawTemplate[] | null;
  voucher_programs: { name: string } | Array<{ name: string }> | null;
};

export async function listOwnedVouchers(params: {
  userId: string;
  walletAddresses: string[];
  status?: OwnedVoucherStatusFilter;
  cursor?: string;
  limit?: number;
}): Promise<{ vouchers: OwnedVoucherSummary[]; next_cursor: string | null }> {
  const { userId, walletAddresses, status, cursor, limit: limitParam } = params;
  const limit = Math.min(Math.max(limitParam ?? 20, 1), 50);
  const scope = cursorScope(userId, status);
  const cursorToken = decodeCursor(cursor, scope);

  const admin = createAdminClient();
  let query = admin
    .from("issued_vouchers")
    .select(`
      id, status, created_at, expires_at, redeemed_at, rules_snapshot,
      spend_voucher_templates (
        title, voucher_type, miles_cost, discount_percent, discount_cusd, discount_kes, maximum_discount_kes, minimum_spend_kes, terms_text, applicable_category, linked_product_id, retail_value_cusd, retail_value_kes,
        partners ( name, slug, image_url )
      ),
      voucher_redemptions ( merchant_id ),
      voucher_programs ( name )
    `)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  query =
    walletAddresses.length > 0
      ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
      : query.eq("hub_user_id", userId);

  const nowIso = new Date().toISOString();
  if (status === "active") {
    query = query
      .in("status", STATUS_DB_VALUES.active)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  } else if (status === "redeemed") {
    query = query.in("status", STATUS_DB_VALUES.redeemed);
  } else if (status === "expired") {
    query = query.or(
      `status.in.(expired,void),and(status.in.(issued,pending,claiming),expires_at.lte.${nowIso})`,
    );
  }

  // Keyset pagination — "strictly before the last row of the previous page"
  // under the same (created_at DESC, id DESC) ordering the query applies.
  if (cursorToken) {
    query = query.or(
      `created_at.lt.${cursorToken.createdAt},and(created_at.eq.${cursorToken.createdAt},id.lt.${cursorToken.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[vouchers] owned-vouchers query failed:", error.message);
    throw new OwnedVouchersUnavailableError();
  }

  const rows = (data ?? []) as unknown as RawOwnedVoucherRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Participants resolved in one batch across the page, from each voucher's
  // own snapshot.
  const participantIdsByVoucher = new Map<string, string[]>();
  for (const row of page) {
    const ids = snapshotParticipantIds((row as { rules_snapshot?: unknown }).rules_snapshot);
    if (ids.length > 0) participantIdsByVoucher.set(row.id, ids);
  }
  const allParticipantIds = [...new Set([
    ...[...participantIdsByVoucher.values()].flat(),
    ...page.filter((row) => row.status === "redeemed")
      .flatMap((row) => row.voucher_redemptions ?? [])
      .flatMap((redemption) => redemption.merchant_id ? [redemption.merchant_id] : []),
  ])];
  const participantLookup = await resolveSnapshotParticipants(allParticipantIds);
  const participantById = new Map(participantLookup.merchants.map((m) => [m.id, m]));

  const vouchers = page.map((row): OwnedVoucherSummary => {
    const tpl = one(row.spend_voucher_templates);
    const redeemedMerchantId = one(row.voucher_redemptions)?.merchant_id;
    const redeemedMerchant = redeemedMerchantId ? participantById.get(redeemedMerchantId) : null;
    // A primary merchant is not evidence of where a redeemed voucher was used.
    const partner = row.status === "redeemed"
      ? redeemedMerchant ? { ...redeemedMerchant, image_url: redeemedMerchant.imageUrl } : null
      : one(tpl?.partners);
    const program = one(row.voucher_programs);
    const participantIds = participantIdsByVoucher.get(row.id) ?? [];
    const participantMerchants = participantIds
      .map((id) => participantById.get(id))
      .filter((m): m is MerchantSummary => !!m);
    const primary = one(tpl?.partners);
    const entitlement = entitlementFromIssued({ template: tpl, snapshot: row.rules_snapshot, expiresAt: row.expires_at,
      merchants: participantMerchants, primaryMerchant: primary ? { id: "", ...primary, imageUrl: primary.image_url } : null });
    return {
      entitlement,
      participantMerchants,
      participantCount: participantIds.length,
      participantsIncomplete: participantMerchants.length !== participantIds.length,
      id: row.id,
      status: resolveOwnedVoucherStatus(row.status, row.expires_at),
      title: entitlement.title,
      voucherType: entitlement.voucherType,
      milesCost: tpl?.miles_cost ?? 0,
      discountPercent: entitlement.discountPercent,
      discountCusd: entitlement.discountCusd,
      retailValueCusd: tpl?.retail_value_cusd ?? null,
      merchantName: partner?.name ?? null,
      merchantSlug: partner?.slug ?? null,
      merchantLogoUrl: partner?.image_url ?? null,
      programName: program?.name ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      redeemedAt: row.redeemed_at,
    };
  });

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ v: 1, createdAt: last.created_at, id: last.id, scope }) : null;

  return { vouchers, next_cursor: nextCursor };
}
