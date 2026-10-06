// GET /api/v1/me/bootstrap — hub-mobile-app-migration-plan.md "Recommended
// GET /api/v1/me/bootstrap response". Self-only; reuses the same domain
// loaders the web pages already call (resolveHubProfile, the username
// lookup GET /api/me/username already does) and the shared capability
// service, so cookie and bearer callers for the same actor always resolve
// an identical DTO. `unreadNotificationCount` is intentionally omitted —
// notification_outbox has no read/unread tracking today; faking the field
// would be worse than not shipping it yet.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveNativeFeatureFlags } from "@/lib/capabilities/resolveCapabilities";

async function resolveUsername(userId: string, email: string | null): Promise<string | null> {
  try {
    const canonicalId = await resolveHubQuestCanonical({ hubUserId: userId, email });
    const admin = createAdminClient();
    const { data } = await admin
      .from("leaderboard_profiles")
      .select("username")
      .eq("canonical_id", canonicalId)
      .maybeSingle();
    return data?.username ?? null;
  } catch (error) {
    console.error(
      "[api/v1/me/bootstrap] username resolution failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// Plain read of the same column POST /api/me/onboarding writes — not
// getOrCreatePass's RPC, which has quest-emission side effects not
// appropriate for a GET.
async function resolveOnboardingComplete(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hub_user_passes")
    .select("onboarding_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.onboarding_seen_at;
}

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const [profile, username, onboardingComplete] = await Promise.all([
    resolveHubProfile({ userId: actor.userId, email: actor.email }),
    resolveUsername(actor.userId, actor.email),
    resolveOnboardingComplete(actor.userId),
  ]);

  const capabilities = resolveNativeFeatureFlags(actor);

  const body = {
    user: {
      id: actor.userId,
      email: actor.email,
      displayName: profile.displayName,
      username,
    },
    onboarding: {
      complete: onboardingComplete,
      needsWalletChoice: profile.needsPicker,
    },
    capabilities: {
      quests: capabilities.quests,
      nativePush: false, // device-token infra is Phase 5 — not built yet.
    },
  };

  const response = apiSuccess(request, body);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
