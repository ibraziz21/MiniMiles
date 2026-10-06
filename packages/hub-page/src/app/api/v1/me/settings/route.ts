// GET /api/v1/me/settings — hub-mobile-app-migration-plan.md "Settings
// `/me/settings`". Reuses exactly the reads
// src/app/(protected)/me/settings/page.tsx already assembles. The wallet
// list is the existing GET /api/me/wallets query, extracted into
// listLinkedWallets so both routes call the same loader — it already never
// touches wallet_link_challenges (nonce/statement_hash live in a
// completely separate table this query doesn't select from), so the
// plan's "never expose challenge secrets" rule is satisfied by
// construction, not something new to guard against here.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { listLinkedWallets } from "@/lib/akiba/wallets";
import { buildIdentities } from "@/lib/akiba/identities";
import { isSupportedCountryInput } from "@/lib/akiba/countryCodes";

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

  const [resolvedProfile, hubProfileResult, canonicalId, wallets] = await Promise.all([
    resolveHubProfile({ userId: actor.userId, email: actor.email }),
    admin.from("hub_user_profiles").select("country, city, phone").eq("user_id", actor.userId).maybeSingle(),
    resolveHubQuestCanonical({ hubUserId: actor.userId, email: actor.email }),
    listLinkedWallets(actor.userId),
  ]);

  const leaderboardResult = await admin
    .from("leaderboard_profiles")
    .select("username")
    .eq("canonical_id", canonicalId)
    .maybeSingle();

  const { activeRow, displayName } = resolvedProfile;
  const hubProfile = hubProfileResult.data;
  const username = leaderboardResult.data?.username ?? activeRow?.username ?? null;

  const response = apiSuccess(request, {
    profile: {
      displayName,
      username,
      avatarUrl: activeRow?.avatar_url ?? null,
      email: actor.email,
      country: hubProfile?.country ?? activeRow?.country ?? null,
      city: hubProfile?.city ?? null,
      phone: hubProfile?.phone ?? null,
    },
    wallets,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_ERRORS: Record<string, string> = {
  "invalid-format": "Usernames are 3-20 lowercase letters, numbers, or underscores.",
  "reserved-name": "That username is reserved.",
  "already-taken": "That username is already taken.",
  "cooldown-active": "You can change your username again 30 days after your last change.",
  "rate-limited": "Too many attempts — try again in a bit.",
};

/** Native counterpart to the existing /api/me and /api/me/username edits. */
export async function PATCH(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    throw error;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError(request, "invalid_body", "A JSON body is required", 400);
  const { username, country, city, phone } = body;
  if (username === undefined && country === undefined && city === undefined && phone === undefined) {
    return apiError(request, "nothing_to_update", "Nothing to update", 400);
  }
  const admin = createAdminClient();
  const result: { ok: true; username?: string; country?: string; city?: string | null; phone?: string | null } = { ok: true };

  if (username !== undefined) {
    const normalized = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!USERNAME_RE.test(normalized)) return apiError(request, "invalid_username", USERNAME_ERRORS["invalid-format"], 400);
    const canonicalId = await resolveHubQuestCanonical({ hubUserId: actor.userId, email: actor.email });
    const { data, error } = await admin.rpc("set_leaderboard_username", { p_canonical_id: canonicalId, p_username: normalized });
    if (error) return apiError(request, "username_update_failed", "Could not update username", 500, { retryable: true });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) return apiError(request, row?.error_code ?? "username_update_failed", USERNAME_ERRORS[row?.error_code] ?? "Could not update username", 422);
    result.username = row.username ?? normalized;
  }

  if (country !== undefined) {
    if (typeof country !== "string" || !isSupportedCountryInput(country)) return apiError(request, "invalid_country", "Unsupported country", 400);
    const identities = await buildIdentities({ userId: actor.userId, email: actor.email });
    const { error } = await admin.rpc("set_hub_profile_country", { p_user_id: actor.userId, p_identities: identities, p_country: country.trim() });
    if (error) return apiError(request, "profile_update_failed", "Could not update profile", 500, { retryable: true });
    result.country = country.trim();
  }

  if (city !== undefined || phone !== undefined) {
    if (city !== undefined && typeof city !== "string") return apiError(request, "invalid_city", "City must be a string", 400);
    if (phone !== undefined && typeof phone !== "string") return apiError(request, "invalid_phone", "Phone must be a string", 400);
    const patch: Record<string, unknown> = { user_id: actor.userId, updated_at: new Date().toISOString() };
    if (city !== undefined) { patch.city = city.trim() || null; result.city = city.trim() || null; }
    if (phone !== undefined) { patch.phone = phone.trim() || null; patch.phone_verified = false; result.phone = phone.trim() || null; }
    const { error } = await admin.from("hub_user_profiles").upsert(patch, { onConflict: "user_id" });
    if (error) return apiError(request, "profile_update_failed", "Could not update profile", 500, { retryable: true });
  }

  return apiSuccess(request, result);
}
