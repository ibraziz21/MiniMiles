import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimHubCanonicalQuest } from "@/lib/akiba/canonicalPartnerQuests";
import { getQuestCatalogEntry } from "@/lib/akiba/questCatalog";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";
import { checkAllRateLimits } from "@/lib/rateLimit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHubQuestsEnabledFor(user.email ?? user.id)) {
    return NextResponse.json({ error: "Not available yet" }, { status: 403 });
  }
  if (!await checkAllRateLimits([
    { scope: `quest_claim:user:${user.id}`, limit: 20, windowSeconds: 600 },
  ])) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const questKey = body?.questKey;
  if (typeof questKey !== "string" || !getQuestCatalogEntry(questKey)) {
    return NextResponse.json({ error: "Valid questKey is required" }, { status: 400 });
  }

  try {
    const result = await claimHubCanonicalQuest({
      hubUserId: user.id,
      email: user.email ?? null,
      questKey,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Quest action is not verified", reason: result.reason },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[quests/claim] canonical claim failed:", error);
    return NextResponse.json(
      { error: "Quest reward is temporarily unavailable", state: "service_unavailable" },
      { status: 503 },
    );
  }
}
