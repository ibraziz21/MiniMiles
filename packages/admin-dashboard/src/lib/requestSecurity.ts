/** Reject cross-site cookie-authenticated mutations. */
export function isTrustedMutationRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "same-site";

  // Internal/test callers may omit browser fetch metadata outside production.
  return process.env.NODE_ENV !== "production";
}
