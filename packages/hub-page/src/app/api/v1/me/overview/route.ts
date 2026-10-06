// GET /api/v1/me/overview — hub-mobile-app-migration-plan.md "Profile
// `/me`". Reuses exactly the reads src/app/(protected)/me/page.tsx already
// assembles (resolveHubProfile, hub_user_profiles, the canonical-username
// lookup, getUserBalance, getRecentActivity, listSavedMerchants,
// getProfileStats, getVerifiedDiscoveryHighlights, getOwnedVoucherPreviews)
// with the actor's identity instead of the page's cookie session — no new
// business logic. Exposes raw structured fields (city/country/displayName)
// rather than the page's pre-joined "City, Country" presentation string;
// the canonical id itself (an internal join key only) is resolved but
// never serialized into the response, same as the page never displays it.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { getUserBalance } from "@/lib/akiba/balance";
import { getRecentActivity } from "@/lib/akiba/activity";
import { getLinkedWalletAddresses, getOwnedVoucherPreviews } from "@/lib/akiba/myVouchers";
import { getProfileStats } from "@/lib/akiba/profileStats";
import { listSavedMerchants } from "@/lib/merchants/savedMerchants";
import { getVerifiedDiscoveryHighlights } from "@/lib/home/verifiedDiscovery";

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

  const admin = createAdminClient();

  const [resolvedProfile, hubProfileResult, canonicalId, walletAddresses] = await Promise.all([
    resolveHubProfile({ userId: actor.userId, email: actor.email }),
    admin.from("hub_user_profiles").select("country, city").eq("user_id", actor.userId).maybeSingle(),
    resolveHubQuestCanonical({ hubUserId: actor.userId, email: actor.email }),
    getLinkedWalletAddresses(actor.userId).catch(() => [] as string[]),
  ]);

  const { activeRow, walletAddress, displayName, needsPicker } = resolvedProfile;
  const hubProfile = hubProfileResult.data;

  const [balance, activity, savedMerchants, stats, leaderboardResult, verifiedPlaces, voucherPreview] =
    await Promise.all([
      getUserBalance({ walletAddress, email: actor.email }),
      getRecentActivity({ userId: actor.userId, walletAddress, email: actor.email, limit: 3 }),
      listSavedMerchants(actor.userId),
      getProfileStats({ userId: actor.userId, walletAddresses }),
      admin.from("leaderboard_profiles").select("username").eq("canonical_id", canonicalId).maybeSingle(),
      getVerifiedDiscoveryHighlights(),
      getOwnedVoucherPreviews({ userId: actor.userId, walletAddresses, limit: 2 }),
    ]);

  const username = leaderboardResult.data?.username ?? activeRow?.username ?? null;

  const response = apiSuccess(request, {
    profile: {
      displayName,
      username,
      avatarUrl: activeRow?.avatar_url ?? null,
      email: actor.email,
      walletAddress,
      city: hubProfile?.city ?? null,
      country: hubProfile?.country ?? activeRow?.country ?? null,
      needsWalletChoice: needsPicker,
    },
    balance,
    stats,
    activity,
    savedMerchants,
    verifiedPlaces,
    voucherPreview,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
