// src/app/api/partner-quests/username/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress } from "viem";
import { claimQueuedPartnerReward } from "@/lib/minipointQueue";

/* ─── env / clients ─────────────────────────────────────── */

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// must match partner_quests.id and the Quest in partner-quests.tsx
const USERNAME_QUEST_ID = "f18818cf-eec4-412e-8311-22e09a1332db";

// 50 akibaMiles for setting username
const USERNAME_REWARD_POINTS = 10;

/* ─── POST ──────────────────────────────────────────────── */

export async function POST(request: Request) {
  try {
    const { userAddress, username } = (await request.json()) as {
      userAddress?: string;
      username?: string;
    };

    if (!userAddress || !username) {
      return NextResponse.json(
        { error: "userAddress and username are required" },
        { status: 400 },
      );
    }

    // ⬇️ Normalize address once
    let checksumAddr: `0x${string}`;
    try {
      checksumAddr = getAddress(userAddress as `0x${string}`);
    } catch {
      return NextResponse.json(
        { error: "Invalid userAddress" },
        { status: 400 },
      );
    }
    const dbAddr = checksumAddr.toLowerCase(); // ⬅️ always lowercase in DB

    /* 1 ▸ one-time check in partner_engagements */
    const { data: existing, error: checkErr } = await supabase
      .from("partner_engagements")
      .select("id", { count: "exact" })
      .eq("user_address", dbAddr)
      .eq("partner_quest_id", USERNAME_QUEST_ID)
      .limit(1);

    if (checkErr) {
      console.error("[username-quest] DB check error:", checkErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 },
      );
    }

    /* 2 ▸ upsert username into users table */
    const { error: upsertErr } = await supabase
      .from("users")
      .upsert(
        {
          user_address: dbAddr,           // ⬅️ lowercase address
          username: username.trim(),
        },
        { onConflict: "user_address" },
      );

    if (upsertErr) {
      console.error("[username-quest] upsert user error:", upsertErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    const points = USERNAME_REWARD_POINTS;
    const result = await claimQueuedPartnerReward({
      userAddress: checksumAddr,
      questId: USERNAME_QUEST_ID,
      points,
      reason: "username-quest",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json(
        { error: "Quest already claimed" },
        { status: 400 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message ?? "queue-error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        minted: points,
        txHash: result.txHash,
        queued: result.queued,
        username: username.trim(),
        userAddress: checksumAddr,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[username-quest] unexpected:", err);
    return NextResponse.json(
      {
        error: "server-error",
        message: err?.shortMessage ?? err?.message ?? "Unexpected error",
      },
      { status: 500 },
    );
  }
}
