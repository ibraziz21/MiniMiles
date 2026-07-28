import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getMerchantQuestStatuses } from "@/lib/server/merchantQuestVerification";
import { isMerchantQuestEnabledForAddress } from "@/lib/server/merchantQuestRollout";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (!isMerchantQuestEnabledForAddress(session.walletAddress)) {
    return NextResponse.json(
      { enabled: false, quests: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const quests = await getMerchantQuestStatuses(session.walletAddress);
    return NextResponse.json(
      { enabled: true, quests },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[merchant-quests/status]", error);
    return NextResponse.json(
      { error: "Could not load merchant quest status" },
      { status: 503 },
    );
  }
}
