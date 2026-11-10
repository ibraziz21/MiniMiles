export type VoucherKind = "free" | "miles" | "reimbursable";
export function voucherKind(v: {
  funding_mode?: string | null;
  miles_cost?: number | null;
}): VoucherKind {
  if (
    ["akiba_reimbursement", "sponsor_reimbursement"].includes(
      v.funding_mode ?? ""
    )
  )
    return "reimbursable";
  return Number(v.miles_cost ?? 0) > 0 ? "miles" : "free";
}
export function voucherState(
  v: {
    active: boolean;
    lifecycle_state: string;
    start_at?: string | null;
    end_at?: string | null;
    expires_at?: string | null;
  },
  now = Date.now()
): string {
  const end = v.end_at || v.expires_at;
  if (v.lifecycle_state === "ended" || (end && Date.parse(end) <= now))
    return "Ended";
  if (v.lifecycle_state !== "published")
    return v.lifecycle_state.replaceAll("_", " ");
  if (!v.active) return "Inactive";
  if (v.start_at && Date.parse(v.start_at) > now) return "Scheduled";
  return "Active";
}
export function voucherReturnPath(
  value?: string,
  fallback = "/vouchers"
): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const u = new URL(value, "https://admin.invalid");
    return u.origin === "https://admin.invalid" &&
      /^\/vouchers(?:\/issued)?(?:\/[0-9a-f-]{36})?$/i.test(u.pathname)
      ? u.pathname + u.search
      : fallback;
  } catch {
    return fallback;
  }
}
export function voucherPeriod(
  value?: string,
  now = new Date()
): { key: string; label: string; from: string | null } {
  if (value === "all") return { key: "all", label: "All time", from: null };
  if (value === "30d")
    return {
      key: "30d",
      label: "Last 30 days",
      from: new Date(now.getTime() - 30 * 86400000).toISOString(),
    };
  const eat = new Date(now.getTime() + 3 * 3600000);
  return {
    key: "month",
    label: "This month",
    from: new Date(
      Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1) - 3 * 3600000
    ).toISOString(),
  };
}
export function claimDuration(
  seconds: number | null | undefined
): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds % 86400 === 0) return `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
export function voucherBenefit(v: {
  discount_percent?: number | null;
  discount_kes?: number | null;
  description?: string | null;
}): string {
  if (v.discount_percent != null) return `${Number(v.discount_percent)}% off`;
  if (v.discount_kes != null)
    return `KES ${Number(v.discount_kes).toLocaleString("en-KE")} credit`;
  return "Merchant offer";
}
export function voucherDateTime(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString("en-KE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Nairobi",
      }) + " EAT"
    : "Not recorded";
}

export function inVoucherPeriod(
  timestamp: string | null | undefined,
  from: string | null
): boolean {
  return (
    !from || Boolean(timestamp && Date.parse(timestamp) >= Date.parse(from))
  );
}
