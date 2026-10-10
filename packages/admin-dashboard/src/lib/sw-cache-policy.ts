// Pure cache-eligibility decision used by public/sw.js (service workers can't
// import from src/, so sw.js mirrors this logic — see the comment there).
// Extracted here so it's unit-testable in Node without a browser/SW runtime.
//
// Spec §11.2 cache table. The default is "don't cache" — every branch below
// is an explicit allow, never an explicit deny-by-exception.

export type CacheStrategy = "cache-first" | "stale-while-revalidate" | "network-only";

const NEVER_CACHE_PATTERNS = [
  /^\/api\//,
  /^\/_next\/data\//, // RSC/data payloads can carry authenticated page data
];

const SIGNED_URL_MARKERS = ["signature=", "token=", "expires=", "x-amz-", "sig="];

export function isSignedUrl(pathAndQuery: string): boolean {
  const query = pathAndQuery.split("?")[1] ?? "";
  const lower = query.toLowerCase();
  return SIGNED_URL_MARKERS.some((marker) => lower.includes(marker));
}

export function getCacheStrategy(pathAndQuery: string): CacheStrategy {
  const path = pathAndQuery.split("?")[0];

  if (NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(path))) return "network-only";
  if (isSignedUrl(pathAndQuery)) return "network-only";

  // Next's build output content-hashes static asset filenames, so a
  // cache-first-by-URL strategy is safe for these without a separate
  // versioning scheme.
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) return "cache-first";

  // Public, unauthenticated login-shell assets only.
  if (path === "/login" || path.startsWith("/svg/")) return "stale-while-revalidate";

  // Everything else — authenticated HTML/RSC navigations, mutation
  // requests, evidence/receipt/preview endpoints not already caught above —
  // is network-only by default.
  return "network-only";
}

export function isCacheEligible(pathAndQuery: string): boolean {
  return getCacheStrategy(pathAndQuery) !== "network-only";
}
