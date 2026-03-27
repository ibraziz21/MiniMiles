// app/api/profile/claim-milestone/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { claimQueuedProfileMilestone } from "@/lib/minipointQueue";
import { supabase as sharedSupabase } from "@/lib/supabaseClient";
import { computeCompletion } from "@/lib/profileCompletion";
import { requireSession } from "@/lib/auth";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const CELO_RPC = "https://forno.celo.org";
const MIN_TX_COUNT = Number(process.env.MIN_CELO_TX_COUNT ?? "3");

// ── Cloudflare Turnstile verification ─────────────────────────────────────────
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && token === "dev-bypass") return true;
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: ip,
        }),
      }
    );
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ── On-chain activity check ────────────────────────────────────────────────────
async function getCeloTxCount(address: string): Promise<number> {
  const provider = new ethers.JsonRpcProvider(CELO_RPC);
  return provider.getTransactionCount(address);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { milestone, turnstileToken } = await req.json();

    if (!["50", "100", 50, 100].includes(milestone)) {
      return NextResponse.json({ error: "Bad params" }, { status: 400 });
    }

    if (!turnstileToken) {
      return NextResponse.json({ error: "Human verification required" }, { status: 400 });
    }

    const address = session.walletAddress;
    const ms = Number(milestone) as 50 | 100;

    // ── 1. Turnstile verification ──────────────────────────────────────────────
    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      "unknown";

    const turnstileOk = await verifyTurnstile(turnstileToken, ip);
    if (!turnstileOk) {
      return NextResponse.json({ error: "Human verification failed. Please try again." }, { status: 403 });
    }

    // ── 2. On-chain activity gate ──────────────────────────────────────────────
    const txCount = await getCeloTxCount(address);
    if (txCount < MIN_TX_COUNT) {
      return NextResponse.json(
        { error: `Wallet must have at least ${MIN_TX_COUNT} transactions on Celo to claim this reward.` },
        { status: 403 }
      );
    }

    // ── 3. Profile & milestone checks ─────────────────────────────────────────
    const { data, error } = await supabase
      .from("users")
      .select(
        "username, full_name, twitter_handle, bio, interests, profile_milestone_50_claimed, profile_milestone_100_claimed"
      )
      .eq("user_address", address)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!data.username) {
      return NextResponse.json(
        { error: "Set a username before claiming profile milestones" },
        { status: 400 }
      );
    }

    const completion = computeCompletion(data);

    if (ms === 50) {
      if (completion < 50)
        return NextResponse.json({ error: "Profile not 50% complete" }, { status: 400 });
      if (data.profile_milestone_50_claimed)
        return NextResponse.json({ error: "already-claimed" }, { status: 400 });
    } else {
      if (completion < 100)
        return NextResponse.json({ error: "Profile not 100% complete" }, { status: 400 });
      if (data.profile_milestone_100_claimed)
        return NextResponse.json({ error: "already-claimed" }, { status: 400 });
    }

    // ── 4. Idempotency / in-flight guard ──────────────────────────────────────
    const idempotencyKey = `profile-milestone:${ms}:${address}`;
    const { data: existingJob } = await sharedSupabase
      .from("minipoint_mint_jobs")
      .select("status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingJob) {
      if (existingJob.status === "completed") {
        const flagField = ms === 50 ? "profile_milestone_50_claimed" : "profile_milestone_100_claimed";
        await supabase.from("users").update({ [flagField]: true }).eq("user_address", address);
        return NextResponse.json({ error: "already-claimed" }, { status: 400 });
      }
      if (existingJob.status === "pending" || existingJob.status === "processing") {
        return NextResponse.json({ error: "Claim already in progress" }, { status: 429 });
      }
    }

    // ── 5. Queue mint ──────────────────────────────────────────────────────────
    const points = ms === 50 ? 50 : 100;

    const result = await claimQueuedProfileMilestone({
      userAddress: address,
      milestone: ms,
      points,
    });

    if (!result.ok) {
      return NextResponse.json({ error: "Mint failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, txHash: result.txHash, queued: result.queued, points });
  } catch (err) {
    console.error("[profile/claim-milestone]", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
