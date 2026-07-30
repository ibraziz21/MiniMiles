import { NextResponse } from "next/server";
import { listPublicMerchants } from "@/lib/merchants/queries";

/**
 * @deprecated Compatibility adapter for the pre-directory `/shop` read path.
 * Delegates to the new public directory read (`list_public_merchants`) so it
 * no longer shows only `store_active` merchants. Remove after the
 * `/merchants` migration window (see merchant-directory-in-store-discovery-spec.md §4).
 *
 * Must reflect current publish/suspension state on every request — no ISR
 * cache (a 60s-stale response could keep showing a merchant an admin just
 * suspended), and must never be statically executed at build time.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await listPublicMerchants({ mode: "all", limit: 50 });

    const merchants = result.merchants.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      country: m.primaryLocation?.city ?? null,
      image_url: m.logoUrl,
      delivery_cities: [] as string[],
      product_count: 0,
      voucher_count: m.voucherCount,
    }));

    return NextResponse.json({ merchants });
  } catch {
    return NextResponse.json({ error: "directory_unavailable" }, { status: 503 });
  }
}
