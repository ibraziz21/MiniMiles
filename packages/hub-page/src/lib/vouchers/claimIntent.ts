import { createAdminClient } from "@/lib/supabase/admin";

export const VOUCHER_USE_PLANS = [
  "nearby",
  "planned_visit",
  "upcoming_trip",
  "other",
] as const;

export type VoucherUsePlan = (typeof VOUCHER_USE_PLANS)[number];

export type VoucherClaimFriction = {
  expiredUnusedCount: number;
  activeUnusedCount: number;
  redeemedCount: number;
  requiresUsePlan: boolean;
};

type VoucherHistoryRow = {
  status: string;
  expires_at: string | null;
};

export function summarizeVoucherClaimHistory(
  rows: VoucherHistoryRow[],
  now = new Date(),
): VoucherClaimFriction {
  const nowMs = now.getTime();
  let expiredUnusedCount = 0;
  let activeUnusedCount = 0;
  let redeemedCount = 0;

  for (const row of rows) {
    if (row.status === "redeemed") {
      redeemedCount += 1;
      continue;
    }

    const expiredByDate =
      row.status === "issued" &&
      !!row.expires_at &&
      new Date(row.expires_at).getTime() <= nowMs;

    if (row.status === "expired" || expiredByDate) {
      expiredUnusedCount += 1;
    } else if (row.status === "issued") {
      activeUnusedCount += 1;
    }
  }

  return {
    expiredUnusedCount,
    activeUnusedCount,
    redeemedCount,
    requiresUsePlan: expiredUnusedCount > 0,
  };
}

export async function getVoucherClaimFriction(hubUserId: string): Promise<VoucherClaimFriction> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("issued_vouchers")
    .select("status, expires_at")
    .eq("hub_user_id", hubUserId);

  if (error) {
    console.error("[voucher claim intent] Could not read voucher history:", error);
    return summarizeVoucherClaimHistory([]);
  }

  return summarizeVoucherClaimHistory((data ?? []) as VoucherHistoryRow[]);
}

export function isVoucherUsePlan(value: unknown): value is VoucherUsePlan {
  return typeof value === "string" && (VOUCHER_USE_PLANS as readonly string[]).includes(value);
}

export function claimIntentIsValid(
  intentConfirmed: unknown,
  usePlan: unknown,
  friction: VoucherClaimFriction,
): boolean {
  return intentConfirmed === true && (!friction.requiresUsePlan || isVoucherUsePlan(usePlan));
}

export async function recordVoucherClaimIntent(input: {
  hubUserId: string;
  voucherId: string;
  flow: "miles_purchase" | "funded_claim" | "loyalty_claim";
  templateId?: string | null;
  allocationId?: string | null;
  usePlan?: VoucherUsePlan | null;
  friction: VoucherClaimFriction;
  disclosureVersion: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("voucher_claim_intents")
    .upsert(
      {
        hub_user_id: input.hubUserId,
        voucher_id: input.voucherId,
        flow: input.flow,
        voucher_template_id: input.templateId ?? null,
        funding_allocation_id: input.allocationId ?? null,
        use_plan: input.usePlan ?? null,
        expired_unused_count_snapshot: input.friction.expiredUnusedCount,
        active_unused_count_snapshot: input.friction.activeUnusedCount,
        redeemed_count_snapshot: input.friction.redeemedCount,
        disclosure_version: input.disclosureVersion,
      },
      { onConflict: "voucher_id" },
    );

  // The voucher has already been issued by this point. Audit recording must
  // never turn a successful claim into an apparent failure that encourages a
  // duplicate retry.
  if (error) {
    console.error("[voucher claim intent] Could not record confirmation:", error);
  }
}
