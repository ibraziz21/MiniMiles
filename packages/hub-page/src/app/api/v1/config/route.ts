// GET /api/v1/config — hub-mobile-app-migration-plan.md "Version and
// force-upgrade contract". Auth-optional: anonymous callers get only
// globally safe values; an authenticated caller's `features` are resolved
// for their actor via the same capability service `/me/bootstrap` uses, so
// the two can never disagree for the same member.
import { optionalActor } from "@/lib/auth/requestActor";
import { apiSuccess } from "@/lib/api/v1/response";
import { resolveNativeFeatureFlags } from "@/lib/capabilities/resolveCapabilities";
import { getVersionGate, getLegalLinks, getStoreLinks } from "@/lib/mobile/appConfig.server";
import { getServerEnv } from "@/lib/env.server";

export async function GET(request: Request) {
  const actor = await optionalActor(request);
  const env = getServerEnv();

  const body = {
    ...getVersionGate(),
    features: resolveNativeFeatureFlags(actor),
    legal: getLegalLinks(env.siteUrl),
    storeUrl: getStoreLinks(),
  };

  const response = apiSuccess(request, body);
  response.headers.set(
    "Cache-Control",
    actor ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300",
  );
  return response;
}
