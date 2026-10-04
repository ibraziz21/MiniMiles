// voucher-web2-username-identity-spec.md §3.2/§5.1/§5.3 — Merchant-side
// wrapper for the shared resolve_voucher_recipient_username RPC (defined in
// supabase/migrations/095_voucher_username_identity_foundation.sql). Server-
// only: never expose hub_user_id/canonical_id to the till.
import { supabase } from "@/lib/supabase";

export type VoucherUsernameErrorCode =
  | "USERNAME_INVALID"
  | "USERNAME_NOT_FOUND"
  | "USERNAME_IDENTITY_UNAVAILABLE";

export type VoucherUsernameResolution =
  | { ok: true; username: string; usernameNormalized: string; hubUserId: string; canonicalId: string }
  | { ok: false; errorCode: VoucherUsernameErrorCode };

/**
 * normalized username -> exactly one active hub_user_id. Fails closed on
 * zero matches or an ambiguous/incomplete identity link — never falls back
 * to email, phone, or wallet (spec §3.2).
 */
export async function resolveVoucherRecipientUsername(
  rawUsername: string,
): Promise<VoucherUsernameResolution> {
  const { data, error } = await supabase.rpc("resolve_voucher_recipient_username", {
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

// Generic, operator-facing copy — per spec §9 a grant username lookup should
// not distinguish "not found" from other failure modes in detail to the
// till, but the admin-dashboard-facing variant of this message set keeps
// specific copy for internal operators. Merchant-facing routes should
// prefer a single generic message instead of branching on these.
export const USERNAME_ERROR_MESSAGES: Record<VoucherUsernameErrorCode, string> = {
  USERNAME_INVALID: "Usernames are 3-20 lowercase letters, numbers, or underscores.",
  USERNAME_NOT_FOUND: "No Akiba member has that username.",
  USERNAME_IDENTITY_UNAVAILABLE: "That username could not be resolved to an account — contact support.",
};
