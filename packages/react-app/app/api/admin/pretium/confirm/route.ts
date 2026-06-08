// POST /api/admin/pretium/confirm
//
// Batch-confirm (or reject) Pretium quest submissions and mint miles
// for confirmed users. Called after Pretium returns their verification CSV.
//
// Auth: Bearer <ADMIN_QUEUE_SECRET>
//
// Body:
// {
//   confirmations: Array<{
//     user_address: string;
//     quest_type: 'signup' | 'transact';
//     status: 'confirmed' | 'rejected';
//   }>
// }
//
// For each confirmed entry that hasn't yet had miles minted:
//  1. Update pretium_quest_submissions.status → 'confirmed', confirmed_at = now
//  2. Enqueue a mint job for the user
//  3. Set miles_minted = true to prevent double-minting

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enqueuePartnerVerifiedReward } from "@/lib/minipointQueue";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

const PRETIUM_SIGNUP_MILES = Number(process.env.PRETIUM_SIGNUP_MILES ?? "50");
const PRETIUM_TRANSACT_MILES = Number(process.env.PRETIUM_TRANSACT_MILES ?? "50");

function milesForQuestType(questType: string): number {
  return questType === "transact" ? PRETIUM_TRANSACT_MILES : PRETIUM_SIGNUP_MILES;
}

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  return bearer === `Bearer ${ADMIN_SECRET}`;
}

type ConfirmEntry = {
  user_address: string;
  quest_type: "signup" | "transact";
  status: "confirmed" | "rejected";
};

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const confirmations: ConfirmEntry[] = body?.confirmations ?? [];

  if (!Array.isArray(confirmations) || confirmations.length === 0) {
    return NextResponse.json({ error: "confirmations array is required" }, { status: 400 });
  }

  let processed = 0;
  let minted = 0;
  const errors: string[] = [];

  for (const entry of confirmations) {
    const { user_address, quest_type, status } = entry;

    if (!user_address || !["signup", "transact"].includes(quest_type) || !["confirmed", "rejected"].includes(status)) {
      errors.push(`Invalid entry: ${JSON.stringify(entry)}`);
      continue;
    }

    const userLc = user_address.toLowerCase();

    try {
      // Fetch the submission row
      const { data: submission, error: fetchErr } = await supabase
        .from("pretium_quest_submissions")
        .select("id, status, miles_minted")
        .eq("user_address", userLc)
        .eq("quest_type", quest_type)
        .maybeSingle();

      if (fetchErr || !submission) {
        errors.push(`No submission found for ${userLc}:${quest_type}`);
        continue;
      }

      if (status === "rejected") {
        await supabase
          .from("pretium_quest_submissions")
          .update({ status: "rejected", confirmed_at: new Date().toISOString() })
          .eq("id", submission.id);
        processed++;
        continue;
      }

      // Confirmed path
      const updatePayload: Record<string, any> = {
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      };

      if (!submission.miles_minted) {
        const questId = `pretium_${quest_type}`;
        const points = milesForQuestType(quest_type);
        const idempotencyKey = `pretium-verified:${questId}:${userLc}`;

        await enqueuePartnerVerifiedReward({ userAddress: userLc, questId, points, idempotencyKey });

        updatePayload.miles_minted = true;
        minted++;
      }

      await supabase
        .from("pretium_quest_submissions")
        .update(updatePayload)
        .eq("id", submission.id);

      processed++;
    } catch (err: any) {
      errors.push(`Error processing ${userLc}:${quest_type} — ${err?.message}`);
    }
  }

  return NextResponse.json({ processed, minted, errors }, { status: 200 });
}
