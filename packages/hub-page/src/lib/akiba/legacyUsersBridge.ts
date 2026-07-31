/**
 * Legacy `users`-table bridge for a newly verified wallet link
 * (production-readiness-security-spec.md §3.3). `users` is owned by another
 * package's schema (no migration for it lives in this repo), so this stays
 * in application code rather than a SQL RPC — see the note in
 * supabase/migrations/051_verified_wallet_linking.sql.
 *
 * Rules:
 *  - No existing row → insert a minimal one.
 *  - Existing row already agrees (or has no email yet) → leave it unchanged.
 *  - Existing row's email conflicts → record an identity_merge_incidents row;
 *    never overwrite either identity automatically.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export async function bridgeLegacyUsersRow(opts: {
  walletAddress: string;
  hubUserId: string;
  hubEmail: string | null;
}): Promise<{ ok: boolean; incidentRecorded: boolean }> {
  const { walletAddress, hubUserId, hubEmail } = opts;
  const admin = createAdminClient();

  const { data: existing, error: selectError } = await admin
    .from("users")
    .select("email")
    .eq("user_address", walletAddress)
    .maybeSingle();

  if (selectError) {
    console.error("[legacyUsersBridge] select failed:", selectError.message);
    return { ok: false, incidentRecorded: false };
  }

  if (!existing) {
    const { error: insertError } = await admin
      .from("users")
      .insert({ user_address: walletAddress, email: hubEmail, is_member: true });
    if (insertError) {
      console.error("[legacyUsersBridge] insert failed:", insertError.message);
      return { ok: false, incidentRecorded: false };
    }
    return { ok: true, incidentRecorded: false };
  }

  if (!existing.email || existing.email === hubEmail) {
    return { ok: true, incidentRecorded: false };
  }

  const { error: incidentError } = await admin.from("identity_merge_incidents").insert({
    hub_user_id: hubUserId,
    wallet_address: walletAddress,
    legacy_email: existing.email,
    hub_email: hubEmail,
    reason: "email_conflict_on_wallet_link",
  });
  if (incidentError) {
    console.error("[legacyUsersBridge] incident insert failed:", incidentError.message);
    return { ok: false, incidentRecorded: false };
  }

  return { ok: true, incidentRecorded: true };
}
