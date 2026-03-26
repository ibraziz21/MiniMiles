// app/api/profile/claim-milestone/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { claimQueuedProfileMilestone } from "@/lib/minipointQueue";
import { supabase as sharedSupabase } from "@/lib/supabaseClient";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const PROFILE_FIELDS = [
  "username",
  "full_name",
  "email",
  "phone",
  "twitter_handle",
  "bio",
  "interests",
] as const;

function computeCompletion(row: Record<string, any>): number {
  let filled = 0;
  for (const f of PROFILE_FIELDS) {
    const v = row[f];
    if (f === "interests") {
      if (Array.isArray(v) && v.length > 0) filled++;
    } else {
      if (v && String(v).trim()) filled++;
    }
  }
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

export async function POST(req: Request) {
  try {
    const { userAddress, milestone } = await req.json();

    if (!userAddress || !["50", "100", 50, 100].includes(milestone)) {
      return NextResponse.json({ error: "Bad params" }, { status: 400 });
    }

    const address = String(userAddress).trim().toLowerCase();
    const ms = Number(milestone) as 50 | 100;

    const { data, error } = await supabase
      .from("users")
      .select(
        "username, full_name, email, phone, twitter_handle, avatar_url, bio, interests, profile_milestone_50_claimed, profile_milestone_100_claimed"
      )
      .eq("user_address", address)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
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

    // Secondary guard: if a completed mint job already exists for this milestone,
    // treat it as claimed even if the DB flag hasn't been written yet.
    const idempotencyKey = `profile-milestone:${ms}:${address}`;
    const { data: existingJob } = await sharedSupabase
      .from("minipoint_mint_jobs")
      .select("status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingJob?.status === "completed") {
      // Flag should be set but isn't yet — set it now and return already-claimed
      const flagField = ms === 50 ? "profile_milestone_50_claimed" : "profile_milestone_100_claimed";
      await supabase.from("users").update({ [flagField]: true }).eq("user_address", address);
      return NextResponse.json({ error: "already-claimed" }, { status: 400 });
    }

    const points = ms === 50 ? 50 : 100;

    const result = await claimQueuedProfileMilestone({
      userAddress: address,
      milestone: ms,
      points,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Mint failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      txHash: result.txHash,
      queued: result.queued,
      points,
    });
  } catch (err) {
    console.error("[profile/claim-milestone]", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
