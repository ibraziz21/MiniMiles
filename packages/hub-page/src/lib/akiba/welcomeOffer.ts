/**
 * New-member welcome offer (docs/BDR-008, migration 126).
 *
 * The database decides everything — campaign state, capacity, who counts as
 * new, and issuing the voucher — inside enrol_welcome_offer. This module
 * only calls it and turns the answer into the member-facing summary, with
 * the internal failure detail kept for logs.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const REASONS = [
  "campaign_unavailable",
  "campaign_not_started",
  "campaign_closed",
  "campaign_full",
  "existing_member",
  "not_eligible",
  "identity_unavailable",
  "voucher_unavailable",
  "unsupported_channel",
  "temporary_failure",
] as const;

export type WelcomeOfferReason = (typeof REASONS)[number];

export type WelcomeOffer =
  | { state: "none" }
  | { state: "unavailable"; reason: WelcomeOfferReason }
  | {
      state: "awarded" | "redeemed" | "expired";
      voucherId: string;
      discountPercent: number;
      maximumDiscountKes: number;
      minimumSpendKes: number;
      expiresAt: string;
    };

const TEMPORARY_FAILURE: WelcomeOffer = { state: "unavailable", reason: "temporary_failure" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function toWelcomeOffer(data: unknown, context: string): WelcomeOffer {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;

  if (row.state === "none") return { state: "none" };

  if (row.state === "unavailable" && typeof row.reason === "string") {
    if (row.reason === "temporary_failure" || row.detail) {
      console.warn(`[welcome-offer] ${context}: ${row.reason}${row.detail ? ` (${String(row.detail)})` : ""}`);
    }
    const reason = (REASONS as readonly string[]).includes(row.reason)
      ? (row.reason as WelcomeOfferReason)
      : "temporary_failure";
    return { state: "unavailable", reason };
  }

  const discountPercent = num(row.discountPercent);
  const maximumDiscountKes = num(row.maximumDiscountKes);
  const minimumSpendKes = num(row.minimumSpendKes);
  const expiresAt = typeof row.expiresAt === "string" ? Date.parse(row.expiresAt) : NaN;
  if (
    (row.state === "awarded" || row.state === "redeemed" || row.state === "expired") &&
    typeof row.voucherId === "string" && UUID.test(row.voucherId) &&
    discountPercent !== null && maximumDiscountKes !== null && minimumSpendKes !== null &&
    Number.isFinite(expiresAt)
  ) {
    return {
      state: row.state,
      voucherId: row.voucherId,
      discountPercent,
      maximumDiscountKes,
      minimumSpendKes,
      // Normalised to UTC ISO so every client parses the same string.
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  console.error(`[welcome-offer] ${context}: unexpected result shape`);
  return TEMPORARY_FAILURE;
}

/**
 * Issues the member their welcome offer if they qualify, or returns the one
 * they already have. Never throws: the app's onboarding must carry on
 * without an offer when anything goes wrong.
 */
export async function enrolWelcomeOffer(hubUserId: string): Promise<WelcomeOffer> {
  try {
    const { data, error } = await createAdminClient().rpc("enrol_welcome_offer", { p_hub_user_id: hubUserId });
    if (error) {
      console.error("[welcome-offer] enrol_welcome_offer failed:", error.message);
      return TEMPORARY_FAILURE;
    }
    return toWelcomeOffer(data, "enrol");
  } catch (err) {
    console.error("[welcome-offer] enrol failed:", err);
    return TEMPORARY_FAILURE;
  }
}

/** The member's existing offer, if any. Never enrols. */
export async function getWelcomeOffer(hubUserId: string): Promise<WelcomeOffer> {
  try {
    const { data, error } = await createAdminClient().rpc("get_welcome_offer", { p_hub_user_id: hubUserId });
    if (error) {
      console.error("[welcome-offer] get_welcome_offer failed:", error.message);
      return TEMPORARY_FAILURE;
    }
    return toWelcomeOffer(data, "read");
  } catch (err) {
    console.error("[welcome-offer] read failed:", err);
    return TEMPORARY_FAILURE;
  }
}
