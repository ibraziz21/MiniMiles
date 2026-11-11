/**
 * "Your voucher expires tomorrow" (migration 125).
 *
 * queue_voucher_expiry_reminders picks the vouchers due a reminder and writes
 * one notification per member; this module runs it and, at send time, checks
 * the vouchers are still worth reminding about.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export async function queueVoucherExpiryReminders(
  admin: SupabaseClient = createAdminClient(),
): Promise<{ queued: number } | { error: string }> {
  const { data, error } = await admin.rpc("queue_voucher_expiry_reminders", {});
  if (error) {
    console.error("[voucher-expiry] queue_voucher_expiry_reminders failed:", error.message);
    return { error: error.message };
  }
  return { queued: Number(data ?? 0) };
}

/**
 * Send-time guard: at least one of the vouchers is still unused and
 * unexpired. A member who used it in the minute since it was queued is not
 * told it is about to expire.
 */
export async function anyVoucherStillUsable(
  admin: SupabaseClient,
  voucherIds: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  const ids = Array.isArray(voucherIds) ? voucherIds.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return false;
  const { data, error } = await admin
    .from("issued_vouchers")
    .select("status, expires_at, redeemed_at")
    .in("id", ids);
  // A failed lookup sends: the vouchers were usable when it was queued.
  if (error) return true;
  return (data ?? []).some(
    (row) =>
      row.status === "issued" &&
      !row.redeemed_at &&
      (!row.expires_at || Date.parse(row.expires_at) > now),
  );
}
