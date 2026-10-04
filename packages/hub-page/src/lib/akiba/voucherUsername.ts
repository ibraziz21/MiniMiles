// voucher-web2-username-identity-spec.md §3.2/§5.1 — the shared
// username <-> hub_user_id resolution every voucher-owned surface uses.
// Server-only: never expose the raw RPC or its hub_user_id/canonical_id
// fields to a client response.
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";

export type VoucherUsernameErrorCode =
  | "USERNAME_INVALID"
  | "USERNAME_NOT_FOUND"
  | "USERNAME_IDENTITY_UNAVAILABLE";

export type ResolvedVoucherRecipient = {
  ok: true;
  username: string;
  usernameNormalized: string;
  hubUserId: string;
  canonicalId: string;
};

export type VoucherUsernameResolution =
  | ResolvedVoucherRecipient
  | { ok: false; errorCode: VoucherUsernameErrorCode };

/**
 * normalized username -> exactly one active hub_user_id. Fails closed on
 * zero matches or an ambiguous/incomplete identity link — never falls back
 * to email, phone, or wallet (spec §3.2).
 */
export async function resolveVoucherRecipientUsername(
  rawUsername: string,
): Promise<VoucherUsernameResolution> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_voucher_recipient_username", {
    p_username: rawUsername,
  });
  if (error) {
    throw new Error(`resolve_voucher_recipient_username failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return { ok: false, errorCode: (row?.error_code ?? "USERNAME_NOT_FOUND") as VoucherUsernameErrorCode };
  }
  return {
    ok: true,
    username: row.username,
    usernameNormalized: row.username_normalized,
    hubUserId: row.hub_user_id,
    canonicalId: row.canonical_id,
  };
}

/**
 * The authenticated member's own current @username, for claim-time display
 * snapshots (spec §3.6) — null when they haven't claimed one yet. Never
 * blocks acquisition on a missing username; the spec's own rollout order
 * (§11 step 1) makes username creation part of onboarding before any claim
 * flow is allowed to require it.
 */
export async function getActiveUsernameForHubUser(input: {
  hubUserId: string;
  email: string | null;
}): Promise<string | null> {
  const canonicalId = await resolveHubQuestCanonical(input);
  const admin = createAdminClient();
  const { data } = await admin
    .from("leaderboard_profiles")
    .select("username")
    .eq("canonical_id", canonicalId)
    .maybeSingle();
  return data?.username ?? null;
}
