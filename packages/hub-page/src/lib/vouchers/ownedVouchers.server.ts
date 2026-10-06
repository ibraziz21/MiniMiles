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
  voucher_type: string;
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  retail_value_cusd: number | null;
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
      id, status, created_at, expires_at, redeemed_at,
      spend_voucher_templates (
        title, voucher_type, miles_cost, discount_percent, discount_cusd, retail_value_cusd,
        partners ( name, slug, image_url )
      ),
      voucher_programs ( name )
    `)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  query =
    walletAddresses.length > 0
      ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
      : query.eq("hub_user_id", userId);

  if (status) {
    query = query.in("status", STATUS_DB_VALUES[status]);
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

  const vouchers = page.map((row): OwnedVoucherSummary => {
    const tpl = one(row.spend_voucher_templates);
    const partner = one(tpl?.partners);
    const program = one(row.voucher_programs);
    return {
      id: row.id,
      status: row.status,
      title: tpl?.title ?? "Voucher",
      voucherType: tpl?.voucher_type ?? "free",
      milesCost: tpl?.miles_cost ?? 0,
      discountPercent: tpl?.discount_percent ?? null,
      discountCusd: tpl?.discount_cusd ?? null,
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
