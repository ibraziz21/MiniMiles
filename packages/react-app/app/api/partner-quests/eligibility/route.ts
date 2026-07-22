// app/api/partner-quests/eligibility/route.ts
//
// Returns eligibility status for a partner quest and, if eligible,
// a short-lived attestation token that /claim will require.
// This is the gating checkpoint — adding quest-specific checks here
// (on-chain holds, partner API calls, etc.) controls who can claim.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { issueClaimToken } from "@/lib/partnerAttestation";
import { checkStableHoldRequirement } from "@/lib/stableHoldGate";
import { isoWeek, weekRange } from "@/lib/games/week";
import {
  QUEST_SPONSORED_LEADERBOARD,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
} from "@/lib/merchantDiscoveryQuests";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Merchant-discovery quest-specific eligibility hooks ──────────────────────
// Returns a reason string when NOT eligible, or null when the quest-specific
// condition is satisfied (the generic already-claimed check still applies).
async function checkMerchantDiscoveryQuest(
  questId: string,
  userLc: string,
): Promise<string | null> {
  if (questId === QUEST_SPONSORED_LEADERBOARD) {
    const week = isoWeek();
    const { from, to } = weekRange(week);

    const { data: alreadyThisWeek } = await supabase
      .from("partner_quest_weekly_claims")
      .select("iso_week")
      .eq("user_address", userLc)
      .eq("partner_quest_id", questId)
      .eq("iso_week", week)
      .maybeSingle();
    if (alreadyThisWeek) return "already-claimed-this-week";

    const { data: session } = await supabase
      .from("skill_game_sessions")
      .select("session_id")
      .eq("wallet_address", userLc)
      .eq("accepted", true)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(1)
      .maybeSingle();
    if (!session) return "no-accepted-session-this-week";
    return null;
  }

  if (questId === QUEST_COMPLETE_PROFILE) {
    const { data: user } = await supabase
      .from("users")
      .select("country")
      .eq("user_address", userLc)
      .maybeSingle();
    if (!user?.country) return "country-not-set";
    return null;
  }

  if (questId === QUEST_REDEEM_VOUCHER) {
    const { data: redeemed } = await supabase
      .from("issued_vouchers")
      .select("id")
      .eq("user_address", userLc)
      .eq("status", "redeemed")
      .limit(1)
      .maybeSingle();
    if (!redeemed) return "no-redeemed-voucher";
    return null;
  }

  return null;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const questId = req.nextUrl.searchParams.get("questId");
  if (!questId) {
    return NextResponse.json({ error: "questId is required" }, { status: 400 });
  }

  const userLc = session.walletAddress;

  if (await isBlacklisted(userLc, "partner-quests/eligibility")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const stableCheck = await checkStableHoldRequirement(userLc);
    if (!stableCheck.ok) {
      return NextResponse.json({
        eligible: false,
        reason: stableCheck.reason,
        message: stableCheck.message,
      }, { status: stableCheck.status });
    }
  } catch {
    return NextResponse.json({ error: "Could not verify stablecoin hold history. Please try again." }, { status: 503 });
  }

  // Verify the quest exists
  const { data: quest, error: questErr } = await supabase
    .from("partner_quests")
    .select("id, reward_points, title")
    .eq("id", questId)
    .single();

  if (questErr || !quest) {
    return NextResponse.json({ error: "Quest not found" }, { status: 404 });
  }

  // Check if already claimed. "Play the sponsored leaderboard" resets weekly,
  // so it tracks completion in partner_quest_weekly_claims instead — the
  // once-ever partner_engagements check doesn't apply to it.
  if (questId !== QUEST_SPONSORED_LEADERBOARD) {
    const { data: existing } = await supabase
      .from("partner_engagements")
      .select("id")
      .eq("user_address", userLc)
      .eq("partner_quest_id", questId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ eligible: false, reason: "already-claimed" });
    }
  }

  // ── Quest-specific eligibility hooks ─────────────────────────────────────
  const merchantQuestReason = await checkMerchantDiscoveryQuest(questId, userLc);
  if (merchantQuestReason) {
    return NextResponse.json({ eligible: false, reason: merchantQuestReason });
  }
  // Add per-quest checks here as quests require on-chain or partner verification.
  // ─────────────────────────────────────────────────────────────────────────

  // Issue a one-time attestation token the /claim endpoint will verify
  const attestationToken = issueClaimToken(userLc, questId);

  return NextResponse.json({
    eligible: true,
    attestationToken,
    points: Number(quest.reward_points),
    expiresInSeconds: 300,
  });
}
