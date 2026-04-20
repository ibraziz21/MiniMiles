// lib/pollEligibility.ts
// Server-side eligibility gate for reward-bearing poll submissions.
//
// Requires the wallet to pass at least one of:
//   - stablecoin hold history (cUSD / USDT / USDC held for MIN_STABLE_HOLD_DAYS)
//   - prior engagement on the platform (at least one completed daily or partner quest)
//
// This is intentionally additive — wallets with stablecoin history OR prior
// engagement pass. A brand-new burner wallet with no history fails both.
//
// Future hooks for Self Protocol verified traits: add checks here against
// poll_responses.verification_source / trait_verification_status when ready.

import { supabase } from "@/lib/supabaseClient";
import { checkStableHoldRequirement } from "@/lib/stableHoldGate";

export type EligibilityResult =
  | { eligible: true; reason: string }
  | { eligible: false; reason: string; userMessage: string };

const REQUIRE_ENGAGEMENT = process.env.POLL_REQUIRE_ENGAGEMENT !== "false";

/**
 * Checks whether a wallet is eligible to earn a reward from a poll.
 * Does NOT check blacklist (caller must do that separately).
 */
export async function checkPollRewardEligibility(
  walletAddress: string
): Promise<EligibilityResult> {
  const addr = walletAddress.toLowerCase();

  // ── Gate 1: stablecoin hold history ────────────────────────────────────────
  let stableOk = false;
  try {
    const result = await checkStableHoldRequirement(addr);
    stableOk = result.ok;
  } catch {
    // RPC error: degrade gracefully — fall through to engagement gate
    stableOk = false;
  }

  if (stableOk) {
    return { eligible: true, reason: "stable-hold" };
  }

  // ── Gate 2: prior engagement history ───────────────────────────────────────
  if (REQUIRE_ENGAGEMENT) {
    // Check daily_engagements
    const { data: dailyRows } = await supabase
      .from("daily_engagements")
      .select("id")
      .eq("user_address", addr)
      .limit(1);

    if (dailyRows && dailyRows.length > 0) {
      return { eligible: true, reason: "prior-daily-engagement" };
    }

    // Check partner_engagements
    const { data: partnerRows } = await supabase
      .from("partner_engagements")
      .select("id")
      .eq("user_address", addr)
      .limit(1);

    if (partnerRows && partnerRows.length > 0) {
      return { eligible: true, reason: "prior-partner-engagement" };
    }
  }

  // ── Both gates failed ───────────────────────────────────────────────────────
  return {
    eligible: false,
    reason: "no-qualifying-history",
    userMessage:
      "To earn Miles from surveys, your wallet needs to hold a stablecoin (cUSD, USDT, or USDC) or have completed at least one other Akiba challenge first.",
  };
}
