// src/app/api/partner-quests/claim/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { claimQueuedPartnerReward } from "@/lib/minipointQueue";
import { isBlacklisted } from "@/lib/blacklist";
import { requireSession } from "@/lib/auth";
import { verifyClaimToken, consumeClaimToken } from "@/lib/partnerAttestation";

/* ─── env / clients ─────────────────────────────────────── */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("[partner-claim] Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/* ─── POST ──────────────────────────────────────────────── */

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { questId, attestationToken } = (await request.json()) as {
      questId?: string;
      attestationToken?: string;
    };

    if (!questId) {
      return NextResponse.json({ error: "questId is required" }, { status: 400 });
    }

    if (!attestationToken) {
      return NextResponse.json({ error: "attestationToken is required" }, { status: 400 });
    }

    const userLc = session.walletAddress;

    if (await isBlacklisted(userLc, "partner-quests/claim")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify the attestation token issued by /eligibility
    if (!verifyClaimToken(userLc, questId, attestationToken)) {
      return NextResponse.json({ error: "Invalid or expired attestation token" }, { status: 403 });
    }
    if (!consumeClaimToken(userLc, questId, attestationToken)) {
      return NextResponse.json({ error: "Attestation token already used" }, { status: 403 });
    }

    /* 1 ▸ one-time check */
    const { data: existing, error: checkErr } = await supabase
      .from("partner_engagements")
      .select("id")
      .eq("user_address", userLc)
      .eq("partner_quest_id", questId)
      .limit(1);

    if (checkErr) {
      console.error("[partner-claim] DB check error:", checkErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 }
      );
    }

    /* 2 ▸ get reward points */
    const { data: quest, error: questErr } = await supabase
      .from("partner_quests")
      .select("reward_points")
      .eq("id", questId)
      .single();

    if (questErr || !quest) {
      console.error("[partner-claim] quest lookup error:", questErr);
      return NextResponse.json({ error: "Quest not found" }, { status: 404 });
    }

    const points = Number(quest.reward_points ?? 0);
    if (!Number.isFinite(points) || points <= 0) {
      return NextResponse.json(
        { error: "Invalid reward points" },
        { status: 400 }
      );
    }

    const result = await claimQueuedPartnerReward({
      userAddress: userLc,
      questId,
      points,
      reason: `partner-quest:${questId}`,
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { minted: points, queued: true },
      { status: 200 }
    );
  } catch (err) {
    console.error("[partner-claim] unexpected:", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
