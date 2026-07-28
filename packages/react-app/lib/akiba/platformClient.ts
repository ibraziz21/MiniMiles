// Server-only Bearer-authed REST client for reading/claiming Platform quests
// (discovery-quests-spec.md §5). Distinct credential from the signed-webhook
// clients in this same directory: this is `Authorization: Bearer ak_live_…`
// against the generic REST API (lib/callerAuth.ts resolves that prefix to an
// 'api_key' caller), the same scheme purchase-events.ts already uses on the
// hub-page side — reuse the SAME AKIBA_API_KEY value here if it's already
// registered under the house Discovery-quests partner account; only
// provision a distinct key if ops wants react-app on its own key.
//
// No ready-made "quest status by identity" endpoint exists on Platform, so
// the BFF route composes three real ones:
//   GET /api/v1/quests                              (list active quests)
//   GET /api/v1/quests/:questId/completions          (has this wallet completed it? -> rewardId)
//   GET /api/v1/rewards/:rewardId                    (is that reward still claimable?)
// confirmed by reading each route directly rather than assuming a single
// "quest list + status" endpoint the spec's narrative implied.
const PLATFORM_TIMEOUT_MS = Number(process.env.PLATFORM_PROXY_TIMEOUT_MS ?? "10000") || 10_000;

export type PlatformFetchResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function fetchPlatform<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = PLATFORM_TIMEOUT_MS
): Promise<PlatformFetchResult<T>> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

  if (!AKIBA_API_URL || !AKIBA_API_KEY) {
    return { ok: false, status: 503, error: "Platform not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${AKIBA_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${AKIBA_API_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    const body = text ? JSON.parse(text) : {};

    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error?.message ?? `Platform responded ${res.status}` };
    }
    return { ok: true, data: (body?.data ?? body) as T };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    console.error("[platformClient] request failed:", path, e);
    return { ok: false, status: timedOut ? 504 : 502, error: timedOut ? "Platform request timed out" : "Network error reaching Platform" };
  } finally {
    clearTimeout(timeoutId);
  }
}
