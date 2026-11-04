/**
 * Server-side reader for the Pass app's public directory API.
 *
 * Why an HTTP hop rather than reading Postgres here: the projection behind it
 * mints signed storage URLs and runs through `get_public_merchant`, which
 * needs a Supabase service-role key. Keeping that key in the Pass app and
 * fetching an already-public projection means this marketing site holds no
 * privileged credential at all.
 *
 * Every call is server-only — never imported into a client component — so the
 * directory origin stays a deployment detail and no browser talks to the Pass
 * API directly.
 */
import type { DirectoryMerchantProfile, DirectoryMerchantSummary } from "./types";

const DIRECTORY_API_BASE =
  process.env.DIRECTORY_API_BASE ??
  process.env.NEXT_PUBLIC_PASS_URL ??
  "https://pass.akibamiles.com";

/**
 * Matches the API's own `s-maxage`. Next's data cache absorbs crawler bursts
 * on the same profile, while a new merchant or a changed offer still appears
 * within the window.
 */
const REVALIDATE_SECONDS = 300;

const REQUEST_TIMEOUT_MS = 5_000;

export class DirectoryUnavailable extends Error {}

async function getJson<T>(path: string): Promise<T | null> {
  const url = `${DIRECTORY_API_BASE.replace(/\/+$/, "")}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    // A network fault or timeout is an outage, not a missing merchant — the
    // caller must be able to tell those apart so it doesn't serve a 404 for
    // a merchant that exists.
    throw new DirectoryUnavailable(`directory request failed: ${String(error)}`);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DirectoryUnavailable(`directory responded ${response.status}`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new DirectoryUnavailable("directory returned a malformed body");
  }
}

export type DirectoryListParams = {
  category?: string;
  city?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

export async function listDirectoryMerchants(
  params: DirectoryListParams = {}
): Promise<{ merchants: DirectoryMerchantSummary[]; nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.city) search.set("city", params.city);
  if (params.q) search.set("q", params.q);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);

  const query = search.toString();
  const body = await getJson<{ merchants: DirectoryMerchantSummary[]; nextCursor: string | null }>(
    `/api/public/directory/merchants${query ? `?${query}` : ""}`
  );

  // The list endpoint has no "missing" case; a null body means it answered 404
  // for a path it should always serve, which is an outage.
  if (!body) throw new DirectoryUnavailable("directory listing not found");
  return body;
}

/** Null means no such published, complete profile — a genuine 404 for this site. */
export async function getDirectoryMerchant(
  slug: string
): Promise<DirectoryMerchantProfile | null> {
  const body = await getJson<{ merchant: DirectoryMerchantProfile }>(
    `/api/public/directory/merchants/${encodeURIComponent(slug)}`
  );
  return body?.merchant ?? null;
}
