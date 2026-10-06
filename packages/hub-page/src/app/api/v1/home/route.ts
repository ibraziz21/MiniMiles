// GET /api/v1/home — hub-mobile-app-migration-plan.md's Home/"For You"
// contract (`?lat=&lng=&intent=`). Auth-optional; composes the exact same
// loaders the web Home page already calls directly (MemberHome.tsx /
// VisitorLanding.tsx), so there's no separate business logic to drift.
// getHomeFeed already returns `rewards`/`nextReward: null` whenever
// `userId` is null (lib/home/feed.ts) — passing the actor's id straight
// through reuses that existing, already-proven member-gating. The only
// extra member-only data (displayName, the pending discovery-contribution
// nudge) is fetched only `if (actor)`, surfaced under a single `member`
// field that's `null` for anonymous callers.
import { optionalActor } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { getHomeFeed } from "@/lib/home/feed";
import { listDirectoryCities } from "@/lib/merchants/queries";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getNextDiscoveryContributionRequest } from "@/lib/akiba/discoveryContributions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  let lat: number | undefined;
  let lng: number | undefined;
  if (latParam !== null || lngParam !== null) {
    const parsedLat = Number(latParam);
    const parsedLng = Number(lngParam);
    if (
      latParam === null ||
      lngParam === null ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      return apiError(request, "INVALID_COORDINATES", "lat and lng must both be provided and valid", 400);
    }
    lat = parsedLat;
    lng = parsedLng;
  }

  const intent = searchParams.get("intent") ?? undefined;
  const actor = await optionalActor(request);

  let feed, cities;
  try {
    [feed, cities] = await Promise.all([
      getHomeFeed({ userId: actor?.userId ?? null, userEmail: actor?.email ?? null, lat, lng, intent }),
      listDirectoryCities().catch(() => []),
    ]);
  } catch {
    return apiError(request, "HOME_FEED_UNAVAILABLE", "The home feed is temporarily unavailable", 503, {
      retryable: true,
    });
  }

  const member = actor
    ? {
        displayName: (await resolveHubProfile({ userId: actor.userId, email: actor.email })).displayName,
        nextDiscoveryContribution: await getNextDiscoveryContributionRequest(actor.userId).catch(() => null),
      }
    : null;

  const response = apiSuccess(request, { feed, cities, member });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
