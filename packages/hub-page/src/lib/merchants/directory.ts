/**
 * Where the merchant directory is *canonically* published.
 *
 * The hub keeps serving /merchants and /merchants/[slug] indefinitely:
 * released native builds claim those paths as iOS universal links and
 * verified Android app links (`akiba-app/app.json`, and the claimed paths in
 * .well-known/apple-app-site-association), and store-submitted legal copy
 * cites this host. None of that may move.
 *
 * What moves is the canonical URL search engines are pointed at. Inbound
 * links, and so authority, accumulate on the marketing site; a subdomain is
 * a separate property as far as ranking is concerned. Serving the same
 * content on both hosts and naming the marketing site as canonical
 * consolidates the signals without touching a single deep link.
 *
 * Deliberately NOT read from NEXT_PUBLIC_SITE_URL. That variable names the
 * host this deployment actually answers on: env.server.ts validates the
 * M-Pesa callback host against it, and lib/push/origin.ts folds it into a
 * same-origin allowlist. Pointing it at the marketing site would fail
 * validation or quietly widen a CSRF check.
 *
 * Unset means "not migrated yet" — canonicals stay on the hub. That is the
 * safe default: a deployment whose marketing-site routes don't exist yet
 * must not point crawlers at a 404.
 */

type DirectoryEnvironment = {
  [key: string]: string | undefined;
};

/** Path the directory is published under on the marketing site. */
export const DIRECTORY_PATH = "/shops";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Configured marketing-site origin, or null when the directory has not been
 * relocated. Returns null rather than throwing for a malformed value:
 * env.server.ts is where a bad URL becomes a boot failure, and a page render
 * should fall back to the hub's own canonical rather than 500.
 */
export function directoryOrigin(env: DirectoryEnvironment = process.env): string | null {
  const raw = env.NEXT_PUBLIC_DIRECTORY_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimTrailingSlash(parsed.origin);
  } catch {
    return null;
  }
}

/** True once the directory's canonical home is the marketing site. */
export function isDirectoryRelocated(env: DirectoryEnvironment = process.env): boolean {
  return directoryOrigin(env) !== null;
}

/** Canonical URL for the directory listing. */
export function canonicalDirectoryUrl(
  hubSiteUrl: string,
  env: DirectoryEnvironment = process.env
): string {
  const origin = directoryOrigin(env);
  if (origin) return `${origin}${DIRECTORY_PATH}`;
  return `${trimTrailingSlash(hubSiteUrl)}/merchants`;
}

/** Canonical URL for one merchant profile. */
export function canonicalProfileUrl(
  slug: string,
  hubSiteUrl: string,
  env: DirectoryEnvironment = process.env
): string {
  const origin = directoryOrigin(env);
  if (origin) return `${origin}${DIRECTORY_PATH}/${slug}`;
  return `${trimTrailingSlash(hubSiteUrl)}/merchants/${slug}`;
}
