const EXPIRABLE_STATUSES = new Set(["issued", "pending", "claiming"]);

/**
 * Derives the member-facing voucher state from both the persisted workflow
 * status and its hard expiry. Database status transitions may be asynchronous,
 * but an elapsed voucher must never continue to appear usable in a client.
 */
export function resolveOwnedVoucherStatus(
  status: string,
  expiresAt: string | null,
  nowMs = Date.now(),
): string {
  if (!EXPIRABLE_STATUSES.has(status) || !expiresAt) return status;
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs <= nowMs ? "expired" : status;
}

