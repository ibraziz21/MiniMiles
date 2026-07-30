import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  MerchantDirectoryResponse,
  PublicMerchantDetail,
  PublicMerchantSummary,
  PublicVoucherSummary,
} from "./types";

/**
 * Thrown whenever the directory RPCs fail or return a shape this app
 * doesn't recognize. Callers (routes/pages) catch this and render a safe,
 * generic "temporarily unavailable" state — the underlying Supabase/DB
 * error is logged server-side but never forwarded to a public response.
 */
export class DirectoryUnavailableError extends Error {
  constructor(context: string) {
    super(`directory_unavailable: ${context}`);
    this.name = "DirectoryUnavailableError";
  }
}

export class InvalidMerchantCursorError extends Error {
  constructor() {
    super("invalid_merchant_cursor");
    this.name = "InvalidMerchantCursorError";
  }
}

function isValidSummaryRow(row: unknown): row is RawSummaryRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.slug === "string" &&
    typeof r.name === "string" &&
    typeof r.operating_model === "string" &&
    typeof r.branch_count === "number" &&
    typeof r.voucher_count === "number" &&
    typeof r.store_active === "boolean"
  );
}

function isValidDetailJson(value: unknown): value is RawDetailJson {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    typeof v.operatingModel === "string" &&
    typeof v.contacts === "object" &&
    Array.isArray(v.locations) &&
    Array.isArray(v.coreOfferings) &&
    Array.isArray(v.categories) &&
    Array.isArray(v.products)
  );
}

type RawSummaryRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  logo_url: string | null;
  primary_category: { slug: string; name: string } | null;
  categories: Array<{ slug: string; name: string }>;
  operating_model: string;
  primary_location: {
    id: string;
    locality: string | null;
    city: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  branch_count: number;
  voucher_count: number;
  store_active: boolean;
  distance_km: number | null;
};

function mapSummary(row: RawSummaryRow): PublicMerchantSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    logoUrl: row.logo_url,
    primaryCategory: row.primary_category,
    categories: row.categories ?? [],
    operatingModel: row.operating_model as PublicMerchantSummary["operatingModel"],
    primaryLocation: row.primary_location,
    branchCount: row.branch_count,
    voucherCount: row.voucher_count,
    storeActive: row.store_active,
    distanceKm: row.distance_km,
  };
}

export type ListMerchantsParams = {
  q?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  mode?: "physical" | "online" | "all";
  cursor?: string;
  limit?: number;
};

type CursorToken = {
  v: 1;
  name: string;
  id: string;
  distanceKm: number | null;
  scope: string;
};

/**
 * Cursors are opaque to clients but contain every SQL sort key. `scope`
 * binds a cursor to the filters/coordinates that produced it so a stale
 * cursor cannot silently skip results after filters change.
 */
function encodeCursor(token: CursorToken): string {
  return Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
}

function cursorScope(params: ListMerchantsParams): string {
  return createHash("sha256")
    .update(JSON.stringify({
      q: params.q ?? null,
      category: params.category ?? null,
      city: params.city ?? null,
      lat: params.lat ?? null,
      lng: params.lng ?? null,
      radiusKm: params.radiusKm ?? null,
      mode: params.mode ?? "all",
    }))
    .digest("base64url")
    .slice(0, 16);
}

function decodeCursor(cursor: string | undefined, expectedScope: string): CursorToken | null {
  if (!cursor) return null;
  if (cursor.length > 2048) throw new InvalidMerchantCursorError();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      parsed?.v === 1 &&
      typeof parsed.name === "string" &&
      typeof parsed.id === "string" &&
      (parsed.distanceKm === null || typeof parsed.distanceKm === "number") &&
      parsed.scope === expectedScope
    ) {
      return parsed as CursorToken;
    }
  } catch {
    throw new InvalidMerchantCursorError();
  }
  throw new InvalidMerchantCursorError();
}

export async function listPublicMerchants(
  params: ListMerchantsParams
): Promise<MerchantDirectoryResponse> {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const nearby = params.lat != null && params.lng != null;
  const scope = cursorScope(params);
  const cursorToken = decodeCursor(params.cursor, scope);

  // Over-fetch by one row so "is there a next page" doesn't depend on the
  // fragile "page came back full" heuristic.
  const { data, error } = await admin.rpc("list_public_merchants", {
    p_q: params.q ?? null,
    p_category: params.category ?? null,
    p_city: params.city ?? null,
    p_lat: params.lat ?? null,
    p_lng: params.lng ?? null,
    p_radius_km: params.radiusKm ?? null,
    p_mode: params.mode ?? "all",
    p_cursor: cursorToken
      ? JSON.stringify({
          name: cursorToken.name,
          id: cursorToken.id,
          distanceKm: cursorToken.distanceKm,
        })
      : null,
    p_limit: limit + 1,
  });

  if (error) {
    console.error("[merchants] list_public_merchants RPC failed:", error.message);
    throw new DirectoryUnavailableError("list_public_merchants");
  }
  if (!Array.isArray(data)) {
    console.error("[merchants] list_public_merchants returned a non-array shape");
    throw new DirectoryUnavailableError("list_public_merchants_shape");
  }
  if (data.length > 0 && !isValidSummaryRow(data[0])) {
    console.error("[merchants] list_public_merchants row shape did not match expected columns");
    throw new DirectoryUnavailableError("list_public_merchants_shape");
  }

  const rows = data as RawSummaryRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const merchants = page.map(mapSummary);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          name: last.name,
          id: last.id,
          distanceKm: last.distance_km,
          scope,
        })
      : null;

  return {
    merchants,
    next_cursor: nextCursor,
    applied: {
      category: params.category ?? null,
      city: params.city ?? null,
      nearby,
    },
  };
}

type RawDetailJson = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  operatingModel: PublicMerchantDetail["operatingModel"];
  storeActive: boolean;
  contacts: PublicMerchantDetail["contacts"];
  primaryCategory: PublicMerchantDetail["primaryCategory"];
  categories: PublicMerchantDetail["categories"];
  coreOfferings: PublicMerchantDetail["coreOfferings"];
  locations: Array<Record<string, unknown>>;
  products: PublicMerchantDetail["products"];
};

function mapLocation(raw: Record<string, unknown>) {
  return {
    id: raw.id as string,
    name: raw.name as string,
    locationType: raw.locationType as never,
    addressLine1: raw.addressLine1 as string,
    addressLine2: (raw.addressLine2 as string) ?? null,
    building: (raw.building as string) ?? null,
    floorOrUnit: (raw.floorOrUnit as string) ?? null,
    landmark: (raw.landmark as string) ?? null,
    locality: (raw.locality as string) ?? null,
    city: raw.city as string,
    countyOrRegion: (raw.countyOrRegion as string) ?? null,
    postalCode: (raw.postalCode as string) ?? null,
    countryCode: raw.countryCode as string,
    latitude: (raw.latitude as number) ?? null,
    longitude: (raw.longitude as number) ?? null,
    mapsUrl: (raw.mapsUrl as string) ?? null,
    publicPhone: (raw.publicPhone as string) ?? null,
    publicEmail: (raw.publicEmail as string) ?? null,
    publicWhatsapp: (raw.publicWhatsapp as string) ?? null,
    timezone: raw.timezone as string,
    openingHours: (raw.openingHours as never) ?? {},
    isPrimary: Boolean(raw.isPrimary),
    acceptsAkibaPass: Boolean(raw.acceptsAkibaPass),
    acceptsVouchers: Boolean(raw.acceptsVouchers),
  };
}

/**
 * Fetches a merchant's public profile plus generally/user-available
 * vouchers, reusing the canonical availability RPC
 * (`list_available_voucher_template_ids_hub`) so this page never diverges
 * from `/vouchers`'/`/api/shop/vouchers/quote`'s eligibility rules.
 */
export async function getPublicMerchant(
  slug: string,
  hubUserId: string | null
): Promise<PublicMerchantDetail | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_public_merchant", {
    p_slug: slug,
    p_hub_user_id: hubUserId,
  });
  if (error) {
    console.error("[merchants] get_public_merchant RPC failed:", error.message);
    throw new DirectoryUnavailableError("get_public_merchant");
  }
  if (!data) return null;
  if (!isValidDetailJson(data)) {
    console.error("[merchants] get_public_merchant returned an unexpected shape");
    throw new DirectoryUnavailableError("get_public_merchant_shape");
  }

  const raw = data;

  const locations = (raw.locations ?? []).map(mapLocation);
  const branchCount = locations.length;
  const primaryLoc = locations.find((l) => l.isPrimary) ?? locations[0] ?? null;

  const voucherAccepting = new Set(locations.filter((l) => l.acceptsVouchers).map((l) => l.id));
  const locationIds = new Set(locations.map((l) => l.id));

  const [
    { data: templates, error: templatesErr },
    { data: availableRows, error: availabilityErr },
    { data: restrictionRows, error: restrictionsErr },
  ] = await Promise.all([
    admin
      .from("spend_voucher_templates")
      .select(
        "id, title, voucher_type, miles_cost, discount_percent, discount_cusd, applicable_category, linked_product_id, retail_value_cusd, cooldown_seconds, global_cap, expires_at"
      )
      .eq("partner_id", raw.id)
      .eq("active", true)
      .order("miles_cost"),
    admin.rpc("list_available_voucher_template_ids_hub", { p_hub_user_id: hubUserId }),
    admin
      .from("voucher_template_locations")
      .select("template_id, location_id"),
  ]);

  if (templatesErr || availabilityErr || restrictionsErr) {
    console.error(
      "[merchants] voucher availability lookup failed:",
      templatesErr?.message ?? availabilityErr?.message ?? restrictionsErr?.message
    );
    throw new DirectoryUnavailableError("voucher_availability");
  }

  const availableIds = new Set(
    (availableRows ?? []).map((r: { template_id: string } | string) =>
      typeof r === "string" ? r : r.template_id
    )
  );
  const restrictionsByTemplate = new Map<string, string[]>();
  for (const row of (restrictionRows ?? []) as Array<{ template_id: string; location_id: string }>) {
    const list = restrictionsByTemplate.get(row.template_id) ?? [];
    list.push(row.location_id);
    restrictionsByTemplate.set(row.template_id, list);
  }

  const vouchers: PublicVoucherSummary[] = (templates ?? [])
    .filter((t) => availableIds.has(t.id))
    .map((t) => {
      // Defense in depth: only count a restriction row if its location
      // actually belongs to this merchant (the FK already guarantees the
      // location exists, but not that it's owned by this template's
      // partner) and currently accepts vouchers.
      const restricted = restrictionsByTemplate.get(t.id) ?? null;
      const branchIds = restricted
        ? restricted.filter((id) => locationIds.has(id) && voucherAccepting.has(id))
        : null;
      return {
        id: t.id,
        title: t.title,
        voucherType: t.voucher_type,
        milesCost: t.miles_cost,
        discountPercent: t.discount_percent,
        discountCusd: t.discount_cusd,
        applicableCategory: t.applicable_category,
        linkedProductId: t.linked_product_id,
        retailValueCusd: t.retail_value_cusd,
        cooldownSeconds: t.cooldown_seconds,
        globalCap: t.global_cap,
        expiresAt: t.expires_at,
        branchIds,
      };
    })
    // A restriction that resolves to zero valid branches isn't actually
    // obtainable in-store — showing it (with an empty "Available at")
    // would be misleading, so drop it rather than render a broken card.
    .filter((v) => v.branchIds === null || v.branchIds.length > 0);

  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    shortDescription: raw.shortDescription,
    description: raw.description,
    logoUrl: raw.logoUrl,
    bannerUrl: raw.bannerUrl,
    websiteUrl: raw.websiteUrl,
    primaryCategory: raw.primaryCategory,
    categories: raw.categories ?? [],
    operatingModel: raw.operatingModel,
    storeActive: raw.storeActive,
    contacts: raw.contacts,
    primaryLocation: primaryLoc
      ? {
          id: primaryLoc.id,
          locality: primaryLoc.locality,
          city: primaryLoc.city,
          latitude: primaryLoc.latitude,
          longitude: primaryLoc.longitude,
        }
      : null,
    locations,
    branchCount,
    voucherCount: vouchers.length,
    distanceKm: null,
    coreOfferings: raw.coreOfferings ?? [],
    vouchers,
    products: raw.products ?? [],
  };
}

/**
 * Canonical voucher counts for a page of directory-card merchants, using
 * the same availability RPC as `getPublicMerchant`/`/vouchers`/quote-redeem
 * (program state, caps, expiry, cooldown) instead of the RPC's
 * `voucher_count` column, which only counts active+unexpired templates.
 * One shared availability call per page, not per merchant.
 *
 * (Branch-restriction-to-zero-valid-branches filtering, which
 * `getPublicMerchant` also applies, is intentionally not replicated here —
 * it would require fetching every merchant's locations for the whole page.
 * That means a card's count can very rarely be one higher than what the
 * detail page ultimately shows for a merchant with an all-restricted-to-
 * inactive-branches voucher; documented as a known simplification.)
 */
export async function getCanonicalVoucherCounts(
  partnerIds: string[],
  hubUserId: string | null
): Promise<Record<string, number>> {
  if (partnerIds.length === 0) return {};
  const admin = createAdminClient();

  const [{ data: templates, error: templatesErr }, { data: availableRows, error: availabilityErr }] =
    await Promise.all([
      admin
        .from("spend_voucher_templates")
        .select("id, partner_id")
        .in("partner_id", partnerIds)
        .eq("active", true),
      admin.rpc("list_available_voucher_template_ids_hub", { p_hub_user_id: hubUserId }),
    ]);

  if (templatesErr || availabilityErr) {
    console.error(
      "[merchants] canonical voucher count lookup failed:",
      templatesErr?.message ?? availabilityErr?.message
    );
    throw new DirectoryUnavailableError("voucher_counts");
  }

  const availableIds = new Set(
    (availableRows ?? []).map((r: { template_id: string } | string) =>
      typeof r === "string" ? r : r.template_id
    )
  );

  const counts: Record<string, number> = {};
  for (const t of (templates ?? []) as Array<{ id: string; partner_id: string }>) {
    if (!availableIds.has(t.id)) continue;
    counts[t.partner_id] = (counts[t.partner_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Distinct active-location cities across the whole directory (not just the
 * first page), for the city filter chip list. `merchant_locations` has no
 * anon-facing RLS policy, but the service-role admin client (already used
 * throughout this module) reads it directly — the same pattern
 * `app/merchants/page.tsx` already uses for `merchant_categories`.
 */
export async function listDirectoryCities(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("merchant_locations")
    .select("city")
    .eq("active", true);

  if (error) {
    console.error("[merchants] listDirectoryCities failed:", error.message);
    throw new DirectoryUnavailableError("directory_cities");
  }

  const cities = new Set((data ?? []).map((r: { city: string }) => r.city).filter(Boolean));
  return [...cities].sort();
}
