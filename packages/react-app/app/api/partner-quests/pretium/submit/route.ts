// POST /api/partner-quests/pretium/submit
//
// Records a user's intent to complete a Pretium quest.
// Miles are NOT minted here — they are minted after Pretium confirms
// via POST /api/admin/pretium/confirm.
//
// Requirements:
//  - Valid session
//  - User must have an email set on their profile
//  - questType: 'signup' | 'transact'
//  - One submission per (user, questType)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { isBlacklisted } from "@/lib/blacklist";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const VALID_QUEST_TYPES = new Set(["signup", "transact"]);

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userLc = session.walletAddress;

    if (await isBlacklisted(userLc, "partner-quests/pretium/submit")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { questType } = body as { questType?: string };

    if (!questType || !VALID_QUEST_TYPES.has(questType)) {
      return NextResponse.json(
        { error: "questType must be 'signup' or 'transact'" },
        { status: 400 }
      );
    }

    // Require email on profile
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("email")
      .eq("user_address", userLc)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.email) {
      return NextResponse.json(
        {
          error: "email-required",
          message: "Please add your email in your profile before submitting this quest.",
        },
        { status: 422 }
      );
    }

    // Idempotency: check for existing submission
    const { data: existing } = await supabase
      .from("pretium_quest_submissions")
      .select("id, status")
      .eq("user_address", userLc)
      .eq("quest_type", questType)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          submitted: true,
          status: existing.status,
          message:
            existing.status === "confirmed"
              ? "Quest already confirmed."
              : existing.status === "rejected"
              ? "Your submission was not verified by Pretium."
              : "Already submitted — verification pending.",
        },
        { status: 200 }
      );
    }

    const { error: insertErr } = await supabase
      .from("pretium_quest_submissions")
      .insert({
        user_address: userLc,
        email: user.email,
        quest_type: questType,
        status: "pending",
      });

    if (insertErr) {
      // Race condition: another request beat us
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { submitted: true, status: "pending", message: "Already submitted — verification pending." },
          { status: 200 }
        );
      }
      console.error("[pretium/submit] insert error:", insertErr);
      return NextResponse.json({ error: "db-error" }, { status: 500 });
    }

    return NextResponse.json({ submitted: true, status: "pending" }, { status: 200 });
  } catch (err) {
    console.error("[pretium/submit] unexpected:", err);
    return NextResponse.json({ error: "server-error" }, { status: 500 });
  }
}
