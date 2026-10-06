// Active-voucher summary for the member home's conditional vouchers strip
// (§2d). Same ownership resolution as GET /api/shop/vouchers/my (hub_user_id
// match, or legacy user_address match via linked wallets) — queried directly
// server-side here rather than round-tripping through that API route.
import { createAdminClient } from "@/lib/supabase/admin";
import { dealLabel } from "@/lib/akiba/deals";

const EXPIRING_SOON_DAYS = 7;

export function isMissingWalletVerificationColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "42703"
    && typeof candidate.message === "string"
    && candidate.message.includes("hub_user_wallets.verification_status");
}

/** Verified wallet addresses linked to this Hub user — matches the resolution
 *  GET /api/shop/vouchers/my uses (a user can have more than one). Only
 *  `verified` wallets authorize asset/reward lookups
 *  (production-readiness-security-spec.md §3.4/§3.6) — a `legacy_unverified`
 *  row is visible in the wallet UI but cannot be used here. */
export async function getLinkedWalletAddresses(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId)
    .eq("verification_status", "verified");
  if (error) {
    // Databases that have not applied 051_verified_wallet_linking.sql have no
    // trustworthy way to distinguish an owned wallet from a legacy address.
    // Treat those users as walletless until the migration is applied instead
    // of either crashing the page or granting wallet authority incorrectly.
    if (isMissingWalletVerificationColumn(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.address.toLowerCase());
}

export type VoucherStripSummary = {
  activeCount: number;
  expiringSoonCount: number;
};

export type OwnedVoucherPreview = {
  id: string;
  status: "issued" | "pending" | "claiming";
  title: string;
  valueLabel: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  expiresAt: string | null;
};

export type OwnedVoucherPreviewResult = {
  items: OwnedVoucherPreview[];
  totalCount: number;
};

type PreviewTemplate = {
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  discount_percent: number | null;
  discount_cusd: number | null;
  discount_kes: number | null;
  retail_value_cusd: number | null;
  partners:
    | { name: string; image_url: string | null }
    | Array<{ name: string; image_url: string | null }>
    | null;
};

type PreviewSnapshot = {
  title?: string;
  voucher_type?: "free" | "percent_off" | "fixed_off";
  discount_percent?: number | null;
  discount_cusd?: number | null;
  discount_kes?: number | null;
  retail_value_cusd?: number | null;
} | null;

type PreviewRow = {
  id: string;
  status: "issued" | "pending" | "claiming";
  expires_at: string | null;
  rules_snapshot: PreviewSnapshot;
  spend_voucher_templates: PreviewTemplate | PreviewTemplate[] | null;
};

/**
 * The small, server-rendered voucher preview used on Profile. It returns only
 * active vouchers and the fields the compact cards need; the complete wallet
 * and history remain on /vouchers.
 */
export async function getOwnedVoucherPreviews(opts: {
  userId: string;
  walletAddresses: string[];
  limit?: number;
}): Promise<OwnedVoucherPreviewResult> {
  const { userId, walletAddresses, limit = 2 } = opts;
  const admin = createAdminClient();

  let query = admin
    .from("issued_vouchers")
    .select(
      `id, status, expires_at, rules_snapshot,
       spend_voucher_templates (
         title, voucher_type, discount_percent, discount_cusd, discount_kes,
         retail_value_cusd,
         partners ( name, image_url )
       )`,
      { count: "exact" },
    )
    .in("status", ["issued", "pending", "claiming"])
    .order("expires_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  query = walletAddresses.length > 0
    ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
    : query.eq("hub_user_id", userId);

  const { data, error, count } = await query;
  if (error) {
    console.error("[myVouchers] profile preview query error →", error.message);
    return { items: [], totalCount: 0 };
  }

  const items = ((data ?? []) as unknown as PreviewRow[]).map((row) => {
    const template = Array.isArray(row.spend_voucher_templates)
      ? row.spend_voucher_templates[0] ?? null
      : row.spend_voucher_templates;
    const merchant = template
      ? (Array.isArray(template.partners) ? template.partners[0] ?? null : template.partners)
      : null;
    const valueSource = template ?? row.rules_snapshot;
    const canFormatValue = valueSource?.voucher_type != null;

    return {
      id: row.id,
      status: row.status,
      title: template?.title ?? row.rules_snapshot?.title ?? "Akiba voucher",
      valueLabel: canFormatValue
        ? dealLabel({
            voucher_type: valueSource.voucher_type!,
            discount_percent: valueSource.discount_percent ?? null,
            discount_cusd: valueSource.discount_cusd ?? null,
            discount_kes: valueSource.discount_kes ?? null,
            retail_value_cusd: valueSource.retail_value_cusd ?? null,
          })
        : "Voucher",
      merchantName: merchant?.name ?? "Akiba reward",
      merchantLogoUrl: merchant?.image_url ?? null,
      expiresAt: row.expires_at,
    };
  });

  return { items, totalCount: count ?? items.length };
}

export async function getActiveVoucherSummary(opts: {
  userId: string;
  walletAddresses: string[];
}): Promise<VoucherStripSummary> {
  const { userId, walletAddresses } = opts;
  const admin = createAdminClient();

  let query = admin
    .from("issued_vouchers")
    .select("id, status, expires_at")
    .eq("status", "issued");

  query = walletAddresses.length > 0
    ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
    : query.eq("hub_user_id", userId);

  const { data, error } = await query;
  if (error) {
    console.error("[myVouchers] query error →", error.message);
    return { activeCount: 0, expiringSoonCount: 0 };
  }

  const rows = data ?? [];
  const soonCutoff = Date.now() + EXPIRING_SOON_DAYS * 86_400_000;
  const expiringSoonCount = rows.filter(
    (v) => v.expires_at && new Date(v.expires_at).getTime() <= soonCutoff,
  ).length;

  return { activeCount: rows.length, expiringSoonCount };
}

export type SoonestExpiringVoucher = {
  issuedVoucherId: string;
  expiresAt: string;
  merchantSlug: string;
  merchantName: string;
};

type SoonestExpiringRow = {
  id: string;
  expires_at: string;
  spend_voucher_templates:
    | { partners: { slug: string; name: string } | Array<{ slug: string; name: string }> }
    | Array<{ partners: { slug: string; name: string } | Array<{ slug: string; name: string }> }>;
};

/**
 * The single soonest-expiring active voucher — home's "continue this" strip
 * (discovery-blueprint.md §3, workstream 7). Mirrors getActiveVoucherSummary's
 * exact ownership resolution above, but also joins through to the merchant
 * (same partner join shape lib/home/feed.ts's buildLimitedTimeSection
 * already uses) since the strip needs a merchant name/slug to link to.
 * Returns null both on a lookup failure and when nothing is within the same
 * EXPIRING_SOON_DAYS window getActiveVoucherSummary already uses — this is
 * a "nothing urgent enough to interrupt with" signal either way, never a
 * fabricated fallback.
 */
export async function getSoonestExpiringVoucher(opts: {
  userId: string;
  walletAddresses: string[];
}): Promise<SoonestExpiringVoucher | null> {
  const { userId, walletAddresses } = opts;
  const admin = createAdminClient();

  let query = admin
    .from("issued_vouchers")
    .select(
      `id, expires_at,
       spend_voucher_templates!inner ( partners!inner ( slug, name ) )`
    )
    .eq("status", "issued")
    .not("expires_at", "is", null)
    .order("expires_at", { ascending: true })
    .limit(1);

  query = walletAddresses.length > 0
    ? query.or(`hub_user_id.eq.${userId},user_address.in.(${walletAddresses.join(",")})`)
    : query.eq("hub_user_id", userId);

  const { data, error } = await query;
  if (error) {
    console.error("[myVouchers] soonest-expiring query error →", error.message);
    return null;
  }

  const row = (data as unknown as SoonestExpiringRow[] | null)?.[0];
  if (!row) return null;

  const soonCutoff = Date.now() + EXPIRING_SOON_DAYS * 86_400_000;
  if (new Date(row.expires_at).getTime() > soonCutoff) return null;

  const template = Array.isArray(row.spend_voucher_templates)
    ? row.spend_voucher_templates[0]
    : row.spend_voucher_templates;
  const partner = template ? (Array.isArray(template.partners) ? template.partners[0] : template.partners) : null;
  if (!partner) return null;

  return {
    issuedVoucherId: row.id,
    expiresAt: row.expires_at,
    merchantSlug: partner.slug,
    merchantName: partner.name,
  };
}
