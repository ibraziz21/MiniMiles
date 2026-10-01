export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHosts = new Set<string>([new URL(req.url).host.toLowerCase()]);
    const hostHeader = firstHeaderHost(req.headers.get("host"));
    const forwardedHost = firstHeaderHost(req.headers.get("x-forwarded-host"));
    if (hostHeader) requestHosts.add(hostHeader);
    if (forwardedHost) requestHosts.add(forwardedHost);

    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (configuredSiteUrl) {
      requestHosts.add(new URL(configuredSiteUrl).host.toLowerCase());
    }

    return requestHosts.has(originHost);
  } catch {
    return false;
  }
}

/**
 * Host and X-Forwarded-Host are the authoritative public request hosts when
 * Next.js is behind a reverse proxy. A proxy chain may provide a comma-
 * separated value. The first entry is the original public host; later entries
 * belong to proxy hops and must not broaden the allowlist.
 */
function firstHeaderHost(value: string | null): string | null {
  const host = value?.split(",", 1)[0]?.trim().toLowerCase();
  return host || null;
}
