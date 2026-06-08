// POST /api/quests/daily/confirm  { txHash: "0x..." }
//
// Called by the frontend after the on-chain TX is confirmed.
// The daily_engagements row was already written by the voucher route, so this
// is a low-stakes UPDATE — it stamps the tx_hash and marks the source as
// confirmed. If it fails (e.g. transient network), the streak still works
// because the row already exists; we just won't have the tx_hash stored.

import { requireSession, logSessionAge } from "@/lib/auth";
import { getQuest } from "@/lib/questRegistry";
import { supabase } from "@/lib/supabaseClient";
import { isBlacklisted } from "@/lib/blacklist";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return Response.json({ success: false, message: "Authentication required" }, { status: 401 });
    }

    const addr = session.walletAddress.toLowerCase();
    logSessionAge("quests/daily/confirm", addr, session.issuedAt);

    if (await isBlacklisted(addr, "quests/daily")) {
      return Response.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const { txHash } = await req.json().catch(() => ({ txHash: undefined }));

    const quest = getQuest("daily_checkin");
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabase
      .from("daily_engagements")
      .update({ source: "onchain", tx_hash: txHash ?? null })
      .eq("user_address", addr)
      .eq("quest_id", quest.questId)
      .eq("claimed_at", today)
      .eq("source", "onchain_pending"); // only update if still pending (idempotent)

    if (error) {
      // Non-fatal — Miles already minted. Log but don't fail the user.
      console.error("[daily-confirm] update error:", error);
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("[daily-confirm]", err);
    return Response.json({ success: false, message: err?.message ?? "Error" }, { status: 500 });
  }
}
