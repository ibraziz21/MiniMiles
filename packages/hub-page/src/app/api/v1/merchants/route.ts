// GET /api/v1/merchants — the public, CDN-cacheable half of the merchant
// directory (hub-mobile-app-migration-plan.md "Merchant directory
// `/merchants`"). Always resolves voucher availability/offers as if the
// caller were anonymous (`balance: null`, no actor identity passed to
// getCanonicalVoucherCounts/getTopOffers) so the response never varies by
// who's asking and can be cached publicly. A signed-in caller's balance and
// saved-state live in the self-only overlay, GET /api/v1/me/merchant-state
// — the client composes affordability itself from this response's
// `topOffer.milesCost` plus the overlay's `balance`.
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { listPublicMerchants, getCanonicalVoucherCounts, InvalidMerchantCursorError } from "@/lib/merchants/queries";
import { getTopOffers, toMerchantValueSummary } from "@/lib/merchants/enrich";

const MAX_RADIUS_KM = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const modeParam = searchParams.get("mode");
  if (modeParam !== null && !["physical", "online", "all"].includes(modeParam)) {
    return apiError(request, "INVALID_MODE", "mode must be physical, online, or all", 400);
  }
  const mode = (modeParam as "physical" | "online" | "all" | null) ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;

  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  let lat: number | undefined;
  let lng: number | undefined;
  let radiusKm: number | undefined;

  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  const radiusParam = searchParams.get("radius_km");
  if ((latParam === null) !== (lngParam === null)) {
    return apiError(request, "INVALID_COORDINATES", "lat and lng must be provided together", 400);
  }
  if (radiusParam !== null && (latParam === null || lngParam === null)) {
    return apiError(request, "INVALID_RADIUS", "radius_km requires lat and lng", 400);
  }
  if (latParam !== null && lngParam !== null) {
    const parsedLat = Number(latParam);
    const parsedLng = Number(lngParam);
    if (
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      return apiError(request, "INVALID_COORDINATES", "lat and lng must be valid coordinates", 400);
    }
    lat = parsedLat;
    lng = parsedLng;

    if (radiusParam !== null) {
      const parsedRadius = Number(radiusParam);
      if (!Number.isFinite(parsedRadius) || parsedRadius <= 0) {
        return apiError(request, "INVALID_RADIUS", "radius_km must be a positive number", 400);
      }
      radiusKm = Math.min(parsedRadius, MAX_RADIUS_KM);
    }
  }

  try {
    const result = await listPublicMerchants({ q, category, city, lat, lng, radiusKm, mode, cursor, limit });

    if (result.merchants.length === 0) {
      const response = apiSuccess(request, { ...result, merchants: [] });
      response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return response;
    }

    const partnerIds = result.merchants.map((m) => m.id);
    const [counts, offers] = await Promise.all([
      getCanonicalVoucherCounts(partnerIds, null),
      getTopOffers(partnerIds, null),
    ]);

    const merchants = result.merchants.map((m) =>
      toMerchantValueSummary(m, offers[m.id], null, q ?? null, counts[m.id] ?? 0),
    );

    const response = apiSuccess(request, { ...result, merchants });
    response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return response;
  } catch (error) {
    if (error instanceof InvalidMerchantCursorError) {
      return apiError(request, "INVALID_CURSOR", "cursor is invalid or stale", 400);
    }
    return apiError(request, "DIRECTORY_UNAVAILABLE", "The merchant directory is temporarily unavailable", 503, {
      retryable: true,
    });
  }
}
