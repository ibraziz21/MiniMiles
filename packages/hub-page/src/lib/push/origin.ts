export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  const allowed = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    const originHost = new URL(origin).host;
    const requestHost = new URL(req.url).host;
    if (originHost === requestHost) return true;
    if (allowed && originHost === new URL(allowed).host) return true;
    return false;
  } catch {
    return false;
  }
}
