// src/app/api/partner-quests/claim/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeMintMiniPoints } from "@/lib/minipoints";

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
    const { userAddress, questId } = (await request.json()) as {
      userAddress?: string;
      questId?: string;
    };

    if (!userAddress || !questId) {
      return NextResponse.json(
        { error: "userAddress and questId are required" },
        { status: 400 }
      );
    }

    const userLc = userAddress.toLowerCase();

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

    /* 3 ▸ mint (with nonce/gas race retries via shared helper) */
    const txHash = await safeMintMiniPoints({
      to: userLc as `0x${string}`,
      points,
      reason: `partner-quest:${questId}`,
    });

    /* 4 ▸ record engagement */
    const { error: insertErr } = await supabase
      .from("partner_engagements")
      .insert({
        user_address: userLc,
        partner_quest_id: questId,
        claimed_at: new Date().toISOString(),
        points_awarded: points,
      });

    if (insertErr) {
      console.error("[partner-claim] insert error:", insertErr);
      // Note: mint already happened; we return a DB error so you can inspect/reconcile.
      return NextResponse.json(
        { error: "db-error", txHash, minted: points },
        { status: 500 }
      );
    }

    /* 5 ▸ done */
    return NextResponse.json({ minted: points, txHash }, { status: 200 });
  } catch (err) {
    console.error("[partner-claim] unexpected:", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
