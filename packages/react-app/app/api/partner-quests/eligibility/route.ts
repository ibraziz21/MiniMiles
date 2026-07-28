// app/api/partner-quests/eligibility/route.ts
//
// Returns eligibility status for a partner quest and, if eligible,
// a short-lived attestation token that /claim will require.
// This is the gating checkpoint — adding quest-specific checks here
// (on-chain holds, partner API calls, etc.) controls who can claim.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";
import { issueClaimToken } from "@/lib/partnerAttestation";
import { checkStableHoldRequirement } from "@/lib/stableHoldGate";
import { isoWeek } from "@/lib/games/week";
import { QUEST_SPONSORED_LEADERBOARD } from "@/lib/merchantDiscoveryQuests";
import { supabase } from "@/lib/supabaseClient";
import {
  isMerchantDiscoveryQuestId,
  verifyMerchantQuestAction,
} from "@/lib/server/merchantQuestVerification";
import { shouldGateMerchantQuest } from "@/lib/server/merchantQuestRollout";

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
  if (
    isMerchantDiscoveryQuestId(questId) &&
    shouldGateMerchantQuest(questId, userLc)
  ) {
    return NextResponse.json(
      { error: "Merchant quests are not available" },
      { status: 404 },
    );
  }

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
  } else {
    const { data: weeklyClaim, error: weeklyClaimError } = await supabase
      .from("partner_quest_weekly_claims")
      .select("iso_week")
      .eq("user_address", userLc)
      .eq("partner_quest_id", questId)
      .eq("iso_week", isoWeek())
      .maybeSingle();

    if (weeklyClaimError) {
      console.error("[partner-quests/eligibility] weekly claim lookup", weeklyClaimError);
      return NextResponse.json(
        { error: "Could not verify quest completion" },
        { status: 503 },
      );
    }
    if (weeklyClaim) {
      return NextResponse.json({
        eligible: false,
        reason: "already-claimed-this-week",
      });
    }
  }

  // ── Quest-specific eligibility hooks ─────────────────────────────────────
  let merchantQuestVerification;
  try {
    merchantQuestVerification = await verifyMerchantQuestAction(
      questId,
      userLc,
    );
  } catch (error) {
    console.error("[partner-quests/eligibility] merchant verification", error);
    return NextResponse.json(
      { error: "Could not verify merchant quest progress" },
      { status: 503 },
    );
  }
  if (!merchantQuestVerification.eligible) {
    return NextResponse.json({
      eligible: false,
      reason: merchantQuestVerification.reason,
    });
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
