// GET /api/partner-quests/pretium/status
// Returns the user's Pretium quest submissions (pending/confirmed/none).
// Uses the service key so RLS is not a factor.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("pretium_quest_submissions")
    .select("quest_type, status")
    .eq("user_address", session.walletAddress);

  if (error) {
    console.error("[pretium/status]", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  // Return a map: { signup: 'pending'|'confirmed'|'rejected'|null, transact: ... }
  const result: Record<string, string | null> = { signup: null, transact: null };
  for (const row of data ?? []) {
    result[row.quest_type as string] = row.status as string;
  }

  return NextResponse.json(result);
}
