import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isCustomerPhotosPublicEnabled,
  isVerifiedVisitsPublicEnabled,
} from "@/lib/akiba/verifiedDiscoveryPublicProofFlags";
import { extractPublicExperienceLabels } from "@/lib/discovery/publicExperienceLabels";
import { expandQueryAlias } from "./aliases";
import type {
  MerchantDirectoryResponse,
  PublicCustomerPhoto,
  PublicMerchantDetail,
  PublicMerchantMedia,
  PublicMerchantOffer,
  PublicMerchantSummary,
  PublicVerifiedVisit,
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

const LOCAL_AKIBA_STORE_PREVIEW = {
  id: "4e229b5d-4676-4f73-8399-6ed86e0205d9",
  slug: "akiba-store",
} as const;

/**
 * Akiba Store is intentionally paused in the shared public directory. In a
 * local Next.js development server only, use the same read-only preview that
 * the admin directory review screen uses so Hub and the native app can test
 * the merchant without changing shared/production publication state.
 */
function isLocalAkibaStorePreviewEnabled(): boolean {
  return process.env.NODE_ENV === "development";
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
    Array.isArray(v.categories)
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
  // Controlled alias expansion (spec §8.1) — applied only to the RPC's
  // query text, not to cursor scoping/`applied.category`/etc, which stay
  // keyed on what the caller actually asked for.
  const expandedQ = params.q ? expandQueryAlias(params.q) : params.q;

  // Over-fetch by one row so "is there a next page" doesn't depend on the
  // fragile "page came back full" heuristic.
  const { data, error } = await admin.rpc("list_public_merchants", {
    p_q: expandedQ ?? null,
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

  let rows = data as RawSummaryRow[];
  if (isLocalAkibaStorePreviewEnabled() && !cursorToken) {
    const previewRow = await getLocalAkibaStorePreviewSummary(admin, params);
    if (previewRow && !rows.some((row) => row.id === previewRow.id)) {
      // Akiba Store alphabetically belongs near the front of the directory,
      // and prepending guarantees the local test merchant is visible even
      // when the real RPC page is full. The cursor is still built from the
      // last included public row, so the displaced row appears next page.
      rows = [previewRow, ...rows];
    }
  }
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
  contacts: PublicMerchantDetail["contacts"];
  primaryCategory: PublicMerchantDetail["primaryCategory"];
  categories: PublicMerchantDetail["categories"];
  coreOfferings: PublicMerchantDetail["coreOfferings"];
  locations: Array<Record<string, unknown>>;
  /** New provenance-separated contract. Optional during RPC rollout. */
  merchantMedia?: unknown;
  defaultOffers?: unknown;
  approvedCustomerPhotos?: unknown;
  /** Legacy catalogue data is reduced to safe merchant-authored product media. */
  products?: unknown;
};

async function getLocalAkibaStorePreview(
  admin: ReturnType<typeof createAdminClient>,
): Promise<RawDetailJson | null> {
  const { data, error } = await admin.rpc("preview_merchant_directory", {
    p_partner_id: LOCAL_AKIBA_STORE_PREVIEW.id,
  });

  if (error) {
    console.warn("[merchants] local Akiba Store preview unavailable:", error.message);
    return null;
  }
  if (!isValidDetailJson(data)) {
    console.warn("[merchants] local Akiba Store preview returned an unexpected shape");
    return null;
  }
  if (data.id !== LOCAL_AKIBA_STORE_PREVIEW.id || data.slug !== LOCAL_AKIBA_STORE_PREVIEW.slug) {
    console.warn("[merchants] local Akiba Store preview identity did not match the allowlist");
    return null;
  }

  return data;
}

function getPreviewPrimaryLocation(raw: RawDetailJson): RawSummaryRow["primary_location"] {
  const locations = raw.locations.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  const location = locations.find((row) => row.isPrimary === true) ?? locations[0];
  if (!location || typeof location.id !== "string" || typeof location.city !== "string") return null;

  return {
    id: location.id,
    locality: typeof location.locality === "string" ? location.locality : null,
    city: location.city,
    latitude: typeof location.latitude === "number" ? location.latitude : null,
    longitude: typeof location.longitude === "number" ? location.longitude : null,
  };
}

function localPreviewMatchesFilters(raw: RawDetailJson, params: ListMerchantsParams): boolean {
  // A preview without coordinates cannot honestly participate in a nearby
  // search. Keep it in the ordinary directory and text/category filters.
  if (params.lat != null || params.lng != null) return false;

  const locations = raw.locations.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  if (params.city) {
    const requestedCity = params.city.trim().toLocaleLowerCase();
    const hasCity = locations.some(
      (location) => typeof location.city === "string" && location.city.toLocaleLowerCase() === requestedCity,
    );
    if (!hasCity) return false;
  }

  if (params.category) {
    const categorySlugs = new Set([
      raw.primaryCategory?.slug,
      ...raw.categories.map((category) => category.slug),
    ].filter((slug): slug is string => typeof slug === "string"));
    if (!categorySlugs.has(params.category)) return false;
  }

  if (params.mode && params.mode !== "all") {
    const supportsPhysical = raw.operatingModel === "physical" || raw.operatingModel === "hybrid";
    const supportsOnline = raw.operatingModel === "online" || raw.operatingModel === "hybrid";
    if (params.mode === "physical" && !supportsPhysical) return false;
    if (params.mode === "online" && !supportsOnline) return false;
  }

  if (params.q) {
    const needle = params.q.trim().toLocaleLowerCase();
    const searchable = [
      raw.name,
      raw.slug,
      raw.shortDescription,
      raw.description,
      raw.primaryCategory?.name,
      ...raw.categories.flatMap((category) => [category.name, category.slug]),
      ...raw.coreOfferings,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLocaleLowerCase();
    if (needle && !searchable.includes(needle)) return false;
  }

  return true;
}

async function getLocalAkibaStorePreviewSummary(
  admin: ReturnType<typeof createAdminClient>,
  params: ListMerchantsParams,
): Promise<RawSummaryRow | null> {
  const raw = await getLocalAkibaStorePreview(admin);
  if (!raw || !localPreviewMatchesFilters(raw, params)) return null;

  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    short_description: raw.shortDescription,
    logo_url: raw.logoUrl,
    primary_category: raw.primaryCategory,
    categories: raw.categories,
    operating_model: raw.operatingModel,
    primary_location: getPreviewPrimaryLocation(raw),
    branch_count: raw.locations.length,
    // The list/API enrichment layer replaces this with canonical voucher
    // availability, just as it does for normal public-directory rows.
    voucher_count: 0,
    store_active: false,
    distance_km: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function safePublicImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function safeLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 160)
    : fallback;
}

function mapExplicitMerchantMedia(value: unknown, merchantName: string): PublicMerchantMedia[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).flatMap((entry, index) => {
    const row = asRecord(entry);
    if (!row) return [];
    const publicationStatus = row.publicationStatus ?? row.publication_status;
    if (typeof publicationStatus === "string" && publicationStatus !== "published") return [];
    const imageUrl = safePublicImageUrl(row.imageUrl ?? row.image_url);
    if (!imageUrl) return [];
    const thumbnailUrl = safePublicImageUrl(row.thumbnailUrl ?? row.thumbnail_url) ?? imageUrl;
    const kind = row.kind === "product" ? "product" : "business";
    const title = typeof row.title === "string" && row.title.trim().length > 0
      ? row.title.trim().slice(0, 120)
      : null;
    return [{
      id: typeof row.id === "string" ? `merchant-${row.id}` : `merchant-media-${index}`,
      kind,
      imageUrl,
      thumbnailUrl,
      altText: safeLabel(row.altText ?? row.alt_text, title ?? `${merchantName} photo`),
      title,
    }];
  });
}

function mapLegacyProductMedia(value: unknown, merchantName: string): PublicMerchantMedia[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).flatMap((entry, index) => {
    const row = asRecord(entry);
    if (!row) return [];
    if (row.active === false) return [];
    const imageUrl = safePublicImageUrl(row.imageUrl ?? row.image_url);
    if (!imageUrl) return [];
    const title = typeof row.name === "string" && row.name.trim().length > 0
      ? row.name.trim().slice(0, 120)
      : null;
    return [{
      id: typeof row.id === "string" ? `product-${row.id}` : `product-media-${index}`,
      kind: "product" as const,
      imageUrl,
      thumbnailUrl: imageUrl,
      altText: title ? `${title} from ${merchantName}` : `${merchantName} product photo`,
      title,
    }];
  });
}

function safeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function safeDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$/);
  return match?.[1] ?? null;
}

function mapMerchantOffers(value: unknown): PublicMerchantOffer[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 48).flatMap((entry) => {
    const row = asRecord(entry);
    if (!row || typeof row.id !== "string") return [];
    const title = safeOptionalText(row.title, 160);
    const description = safeOptionalText(row.description, 2_000);
    const timezone = safeOptionalText(row.timezone, 100);
    const schedule = row.schedule === "always" || row.schedule === "weekly" ? row.schedule : null;
    if (!title || !description || !timezone || !schedule) return [];

    const daysOfWeek = Array.isArray(row.daysOfWeek)
      ? [...new Set(row.daysOfWeek.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];

    return [{
      id: row.id,
      title,
      description,
      terms: safeOptionalText(row.terms, 4_000),
      schedule,
      daysOfWeek,
      startTime: safeTime(row.startTime),
      endTime: safeTime(row.endTime),
      startsOn: safeDate(row.startsOn),
      endsOn: safeDate(row.endsOn),
      timezone,
      remindersEnabled: row.remindersEnabled === true,
      reminderSet: row.reminderSet === true,
      imageUrl: safePublicImageUrl(row.imageUrl),
      requiresAkibaMiles: false,
    }];
  });
}

type LocalPreviewOfferRow = {
  id: string;
  title: string;
  description: string;
  terms: string | null;
  schedule: string;
  days_of_week: unknown;
  start_time: string | null;
  end_time: string | null;
  starts_on: string | null;
  ends_on: string | null;
  timezone: string;
  reminders_enabled: boolean;
  image_media_id: string | null;
};

/**
 * The directory preview RPC predates merchant-owned offers. Keep this
 * fallback local-only and allowlist-only so a paused Akiba Store can exercise
 * the consumer UI without changing the shared public publication state.
 */
async function getLocalAkibaStoreOffers(
  admin: ReturnType<typeof createAdminClient>,
  merchantMedia: PublicMerchantMedia[],
): Promise<PublicMerchantOffer[]> {
  try {
    const { data, error } = await admin
      .from("merchant_default_offers")
      .select("id, title, description, terms, schedule, days_of_week, start_time, end_time, starts_on, ends_on, timezone, reminders_enabled, image_media_id")
      .eq("partner_id", LOCAL_AKIBA_STORE_PREVIEW.id)
      .eq("status", "live")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[merchants] local Akiba Store offers unavailable:", error.message);
      return [];
    }

    return ((data ?? []) as LocalPreviewOfferRow[]).flatMap((row) => {
      const linkedMedia = row.image_media_id
        ? merchantMedia.find((media) => media.id === `merchant-${row.image_media_id}`)
        : null;
      return mapMerchantOffers([{
        id: row.id,
        title: row.title,
        description: row.description,
        terms: row.terms,
        schedule: row.schedule,
        daysOfWeek: row.days_of_week,
        startTime: row.start_time,
        endTime: row.end_time,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        timezone: row.timezone,
        remindersEnabled: row.reminders_enabled,
        reminderSet: false,
        imageUrl: linkedMedia?.imageUrl ?? null,
      }]);
    });
  } catch (error) {
    console.warn("[merchants] local Akiba Store offer projection failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

function mapApprovedCustomerPhotos(value: unknown, merchantName: string): PublicCustomerPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 48).flatMap((entry, index) => {
    const row = asRecord(entry);
    if (!row) return [];
    const thumbnailUrl = safePublicImageUrl(row.thumbnailUrl ?? row.thumbnail_url);
    const displayUrl = safePublicImageUrl(row.displayUrl ?? row.display_url);
    if (!thumbnailUrl || !displayUrl) return [];
    const itemLabel = typeof (row.itemLabel ?? row.item_label) === "string"
      ? String(row.itemLabel ?? row.item_label).trim().slice(0, 120) || null
      : null;
    return [{
      id: typeof row.id === "string" ? row.id : `customer-photo-${index}`,
      visitId: typeof row.visitId === "string"
        ? row.visitId
        : null,
      thumbnailUrl,
      displayUrl,
      altText: safeLabel(row.altText ?? row.alt_text, itemLabel ?? `Photo from a verified visit to ${merchantName}`),
      itemLabel,
    }];
  });
}

// §7.1: "Public customer-photo signed URLs have a maximum 15-minute
// lifetime and private/no-store response caching."
const APPROVED_PHOTO_URL_TTL_SECONDS = 15 * 60;
const APPROVED_PHOTO_LIMIT = 48;
const DERIVED_VISIT_PHOTO_BUCKET = "discovery-visit-photos-derived";

type EligiblePhotoRow = {
  photo_id: string;
  contribution_id: string;
  thumbnail_key: string;
  display_key: string;
};

/**
 * Moderation is the publication gate for verified-visit photos, but
 * moderation approval alone is not enough to publish (hardening spec
 * §4.2): the underlying contribution and earning event must still be
 * active, unwithdrawn and unsuppressed. That full predicate lives once in
 * the canonical `eligible_public_merchant_visit_photos` projection rather
 * than being re-derived here — a single approved photo is eligible
 * immediately; unlike aggregate review insights, this gallery has no
 * minimum unique-contributor threshold.
 */
async function getIndividuallyApprovedCustomerPhotos(
  admin: ReturnType<typeof createAdminClient>,
  partnerId: string,
  merchantName: string,
): Promise<PublicCustomerPhoto[]> {
  if (!isCustomerPhotosPublicEnabled()) return [];

  try {
    const { data, error } = await admin
      .rpc("eligible_public_merchant_visit_photos", { p_partner_id: partnerId })
      .order("approved_at", { ascending: false })
      .limit(APPROVED_PHOTO_LIMIT);

    if (error) {
      console.error("[merchants] approved visit-photo lookup failed:", error.message);
      return [];
    }

    const rows = (data ?? []) as EligiblePhotoRow[];
    if (rows.length === 0) return [];

    const paths = rows.flatMap((photo) => [photo.thumbnail_key, photo.display_key]);
    const { data: signed, error: signError } = await admin.storage
      .from(DERIVED_VISIT_PHOTO_BUCKET)
      .createSignedUrls(paths, APPROVED_PHOTO_URL_TTL_SECONDS);

    if (signError || !signed) {
      console.error("[merchants] approved visit-photo signing failed:", signError?.message ?? "no signed URLs");
      return [];
    }

    return rows.flatMap((photo, index) => {
      const thumbnailUrl = safePublicImageUrl(signed[index * 2]?.signedUrl);
      const displayUrl = safePublicImageUrl(signed[index * 2 + 1]?.signedUrl);
      if (!thumbnailUrl || !displayUrl) return [];
      return [{
        id: photo.photo_id,
        visitId: typeof photo.contribution_id === "string" ? photo.contribution_id : null,
        thumbnailUrl,
        displayUrl,
        altText: `Photo from a verified visit to ${merchantName}`,
        itemLabel: null,
      }];
    });
  } catch (error) {
    console.error(
      "[merchants] approved visit-photo projection failed:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function mergeCustomerPhotos(
  directApproved: PublicCustomerPhoto[],
  projected: PublicCustomerPhoto[],
): PublicCustomerPhoto[] {
  const byId = new Map<string, PublicCustomerPhoto>();
  for (const photo of [...directApproved, ...projected]) {
    if (!byId.has(photo.id)) byId.set(photo.id, photo);
  }
  return [...byId.values()].slice(0, APPROVED_PHOTO_LIMIT);
}

const PUBLIC_VERIFIED_VISIT_LIMIT = 24;

type EligibleVisitRow = {
  contribution_id: string;
  experience_option_ids: unknown;
  template_snapshot: unknown;
};

/**
 * Public visit cards intentionally project only a positive recommendation
 * and template-owned public labels. Free text, negative feedback, identity,
 * purchase data and timestamps never enter this response. The full
 * eligibility predicate (merchant published/active, request submitted,
 * earning event active, not withdrawn/suppressed) lives once in the
 * canonical `eligible_public_merchant_visits` projection, not re-derived
 * here.
 */
async function getPublicVerifiedVisits(
  admin: ReturnType<typeof createAdminClient>,
  partnerId: string,
): Promise<PublicVerifiedVisit[]> {
  if (!isVerifiedVisitsPublicEnabled()) return [];

  try {
    const { data, error } = await admin
      .rpc("eligible_public_merchant_visits", { p_partner_id: partnerId })
      .order("submitted_at", { ascending: false })
      .limit(PUBLIC_VERIFIED_VISIT_LIMIT);

    if (error) {
      console.error("[merchants] verified-visit lookup failed:", error.message);
      return [];
    }

    return ((data ?? []) as EligibleVisitRow[]).flatMap((row) => {
      const experienceLabels = extractPublicExperienceLabels(row.template_snapshot, row.experience_option_ids, 6);
      return [{ id: row.contribution_id, experienceLabels, photos: [] }];
    });
  } catch (error) {
    console.error("[merchants] verified-visit projection failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

function deduplicateMerchantMedia(media: PublicMerchantMedia[]): PublicMerchantMedia[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    if (seen.has(item.imageUrl)) return false;
    seen.add(item.imageUrl);
    return true;
  });
}

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
  const localPreview = !data && slug === LOCAL_AKIBA_STORE_PREVIEW.slug && isLocalAkibaStorePreviewEnabled()
    ? await getLocalAkibaStorePreview(admin)
    : null;
  const resolvedData = data ?? localPreview;

  if (!resolvedData) return null;
  if (!isValidDetailJson(resolvedData)) {
    console.error("[merchants] get_public_merchant returned an unexpected shape");
    throw new DirectoryUnavailableError("get_public_merchant_shape");
  }

  const raw = resolvedData;

  const locations = (raw.locations ?? []).map(mapLocation);
  const branchCount = locations.length;
  const primaryLoc = locations.find((l) => l.isPrimary) ?? locations[0] ?? null;
  const explicitMerchantMedia = mapExplicitMerchantMedia(raw.merchantMedia, raw.name);
  const legacyProductMedia = mapLegacyProductMedia(raw.products, raw.name);
  const bannerMedia: PublicMerchantMedia[] = raw.bannerUrl && safePublicImageUrl(raw.bannerUrl)
    ? [{
        id: "merchant-banner",
        kind: "business",
        imageUrl: raw.bannerUrl,
        thumbnailUrl: raw.bannerUrl,
        altText: `${raw.name} business photo`,
        title: null,
      }]
    : [];
  const merchantMedia = deduplicateMerchantMedia([
    ...explicitMerchantMedia,
    ...legacyProductMedia,
    ...bannerMedia,
  ]).slice(0, 48);
  const projectedOffers = mapMerchantOffers(raw.defaultOffers);
  const previewOffers = localPreview ? await getLocalAkibaStoreOffers(admin, merchantMedia) : [];
  const projectedOfferIds = new Set(projectedOffers.map((offer) => offer.id));
  const offers = [
    ...projectedOffers,
    ...previewOffers.filter((offer) => !projectedOfferIds.has(offer.id)),
  ];
  // Keep accepting the RPC projection during rollout, but moderation—not a
  // multi-review threshold—is now the public gate for customer photos.
  const projectedCustomerPhotos = mapApprovedCustomerPhotos(raw.approvedCustomerPhotos, raw.name);

  const voucherAccepting = new Set(locations.filter((l) => l.acceptsVouchers).map((l) => l.id));
  const locationIds = new Set(locations.map((l) => l.id));

  const [
    directApprovedCustomerPhotos,
    verifiedVisits,
    { data: templates, error: templatesErr },
    { data: availableRows, error: availabilityErr },
    { data: restrictionRows, error: restrictionsErr },
  ] = await Promise.all([
    getIndividuallyApprovedCustomerPhotos(admin, raw.id, raw.name),
    getPublicVerifiedVisits(admin, raw.id),
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
  const approvedCustomerPhotos = mergeCustomerPhotos(
    directApprovedCustomerPhotos,
    projectedCustomerPhotos,
  );
  const verifiedVisitsWithPhotos = verifiedVisits.map((visit) => ({
    ...visit,
    photos: approvedCustomerPhotos.filter((photo) => photo.visitId === visit.id),
  }));

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
    merchantMedia,
    offers,
    verifiedVisits: verifiedVisitsWithPhotos,
    approvedCustomerPhotos,
    vouchers,
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
