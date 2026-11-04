// GET /api/public/directory/merchants
//
// Read-only directory listing for the marketing site, which renders
// www.akibamiles.com/shops from it. See
// lib/merchants/publicDirectoryContract.ts for why this exists alongside
// /api/v1/merchants rather than being the same endpoint.
//
// Anonymous by construction: `listPublicMerchants` is called with no actor,
// so the response never varies by who's asking and is safe to cache at the
// edge. Unlike the v1 merchant endpoints there are no signed, expiring URLs
// in this payload — the contract excludes customer visit photos precisely so
// this can be cached.
import { NextResponse } from "next/server";
import { listPublicMerchants, DirectoryUnavailableError } from "@/lib/merchants/queries";
import { toDirectorySummary } from "@/lib/merchants/publicDirectoryContract";
import { isProfileIndexable } from "@/lib/merchants/seo";
import type { DirectoryListResponse } from "@/lib/merchants/publicDirectoryContract";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

/** Long enough to absorb a crawl burst, short enough that a new merchant appears the same day. */
const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

function clampLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const indexableOnly = url.searchParams.get("indexableOnly") !== "false";

  try {
    const { merchants, next_cursor } = await listPublicMerchants({
      mode: (url.searchParams.get("mode") as "physical" | "online" | "all") ?? "all",
      category: url.searchParams.get("category") ?? undefined,
      city: url.searchParams.get("city") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: clampLimit(url.searchParams.get("limit")),
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    // The marketing site is an index-facing surface, so by default it sees
    // only profiles complete enough to be indexed — the same rule the
    // sitemap and the profile pages apply.
    const visible = indexableOnly ? merchants.filter(isProfileIndexable) : merchants;

    const body: DirectoryListResponse = {
      merchants: visible.map(toDirectorySummary),
      nextCursor: next_cursor,
    };

    const response = NextResponse.json(body);
    response.headers.set("Cache-Control", CACHE_CONTROL);
    return response;
  } catch (error) {
    if (error instanceof DirectoryUnavailableError) {
      return NextResponse.json(
        { error: { code: "DIRECTORY_UNAVAILABLE", message: "The directory is temporarily unavailable" } },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw error;
  }
}
