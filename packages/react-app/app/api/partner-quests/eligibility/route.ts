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
import { hasAnyBalance } from "@/lib/celoBalanceGate";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

  if (!(await hasAnyBalance(userLc))) {
    return NextResponse.json({
      eligible: false,
      reason: "no-balance",
      message: "You need a wallet balance to claim this quest. Top up with any amount of CELO, cUSD, USDT, or USDC and try again.",
    }, { status: 403 });
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

  // Check if already claimed
  const { data: existing } = await supabase
    .from("partner_engagements")
    .select("id")
    .eq("user_address", userLc)
    .eq("partner_quest_id", questId)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ eligible: false, reason: "already-claimed" });
  }

  // ── Quest-specific eligibility hooks ─────────────────────────────────────
  // Add per-quest checks here as quests require on-chain or partner verification.
  // Example:
  //   if (questId === KILN_QUEST_ID) {
  //     const balance = await getKilnBalance(userLc);
  //     if (balance < MIN_KILN_HOLD) return NextResponse.json({ eligible: false, reason: "insufficient-balance" });
  //   }
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
