// GET /api/public/directory/merchants/:slug
//
// Read-only merchant profile for the marketing site, which renders
// www.akibamiles.com/shops/[slug] from it. See
// lib/merchants/publicDirectoryContract.ts for the shape and for why this is
// not the /api/v1 endpoint the native app uses.
//
// Resolved with no actor identity (`getPublicMerchant(slug, null)`), so the
// response is identical for every caller and cacheable. The contract drops
// customer visit photos, which are the only signed, expiring URLs in the
// projection — without that this could not be cached at all.
import { NextResponse } from "next/server";
import { getPublicMerchant, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { toDirectoryProfile } from "@/lib/merchants/publicDirectoryContract";
import { buildDirectionsUrl, formatStreetAddress } from "@/lib/merchants/directions";
import { isProfileIndexable } from "@/lib/merchants/seo";
import type { DirectoryProfileResponse } from "@/lib/merchants/publicDirectoryContract";

const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  const url = new URL(request.url);
  const indexableOnly = url.searchParams.get("indexableOnly") !== "false";

  let merchant;
  try {
    merchant = await getPublicMerchant(params.slug, null);
  } catch (error) {
    if (error instanceof DirectoryUnavailableError) {
      return NextResponse.json(
        { error: { code: "DIRECTORY_UNAVAILABLE", message: "This profile is temporarily unavailable" } },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }

  // A stub profile 404s here rather than giving the marketing site a thin
  // page to render: the Pass app still serves it, and that is where an
  // incomplete merchant's profile belongs until its information pack lands.
  if (!merchant || (indexableOnly && !isProfileIndexable(merchant))) {
    return NextResponse.json(
      { error: { code: "MERCHANT_NOT_FOUND", message: "Merchant not found" } },
      { status: 404, headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  }

  const body: DirectoryProfileResponse = {
    merchant: toDirectoryProfile(merchant, {
      streetAddress: formatStreetAddress,
      directionsUrl: buildDirectionsUrl,
    }),
  };

  const response = NextResponse.json(body);
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}
