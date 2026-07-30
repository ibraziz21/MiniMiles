import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listPublicMerchants, getCanonicalVoucherCounts } from "@/lib/merchants/queries";

// A live-inventory directory (publish state, open/closed, voucher
// availability) must never be served from a stale static/ISR cache —
// evaluate on every request.
export const dynamic = "force-dynamic";

const MAX_RADIUS_KM = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const q = searchParams.get("q") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const mode = (searchParams.get("mode") as "physical" | "online" | "all" | null) ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;

  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  let lat: number | undefined;
  let lng: number | undefined;
  let radiusKm: number | undefined;

  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  if (latParam !== null && lngParam !== null) {
    const parsedLat = Number(latParam);
    const parsedLng = Number(lngParam);
    if (
      !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) ||
      parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180
    ) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    lat = parsedLat;
    lng = parsedLng;

    const radiusParam = searchParams.get("radius_km");
    if (radiusParam !== null) {
      const parsedRadius = Number(radiusParam);
      if (!Number.isFinite(parsedRadius) || parsedRadius <= 0) {
        return NextResponse.json({ error: "Invalid radius_km" }, { status: 400 });
      }
      radiusKm = Math.min(parsedRadius, MAX_RADIUS_KM);
    }
  }

  try {
    const result = await listPublicMerchants({ q, category, city, lat, lng, radiusKm, mode, cursor, limit });

    // Canonical voucher-count parity (§6): replace the RPC's naive
    // active+unexpired `voucher_count` with the same availability rule
    // used by `/vouchers` and the merchant detail page — one shared
    // availability call per page, personalized only when signed in. Since
    // this route is `force-dynamic`, a signed-in user's cooldown never
    // leaks into a cached anonymous response.
    if (result.merchants.length > 0) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const counts = await getCanonicalVoucherCounts(
        result.merchants.map((m) => m.id),
        user?.id ?? null
      );
      result.merchants = result.merchants.map((m) => ({
        ...m,
        voucherCount: counts[m.id] ?? 0,
      }));
    }

    return NextResponse.json(result);
  } catch {
    // Never forward the underlying Supabase/DB error to a public response;
    // it's already logged server-side inside queries.ts.
    return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  }
}
