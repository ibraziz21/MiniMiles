// POST /api/quests/daily/voucher
//
// Issues a signed EIP-712 voucher the user submits on-chain to claim their
// daily check-in reward from DailyQuestClaimer.sol.
//
// Race-condition protection: the daily_engagements row is inserted BEFORE the
// voucher is signed. The unique constraint (user_address, quest_id, claimed_at)
// is the atomic lock — concurrent requests will hit a 23505 conflict and be
// rejected cleanly, without ever seeing a signed voucher.
//
// If the user gets the voucher but never submits the TX, the pending row stays
// for today (intentional — one attempt per day). Tomorrow is a new claimed_at.

import { isBlacklisted } from "@/lib/blacklist";
import { getQuest } from "@/lib/questRegistry";
import { getCeloTxCount } from "@/lib/celoClient";
import { requireSession, logSessionAge } from "@/lib/auth";
import { signDailyQuestVoucher } from "@/lib/server/dailyQuestVoucher";
import { supabase } from "@/lib/supabaseClient";

const MIN_LIFETIME_TXS = Number(process.env.MIN_CELO_TX_COUNT ?? "3");

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return Response.json({ success: false, message: "Authentication required" }, { status: 401 });
    }

    const addr = session.walletAddress.toLowerCase() as `0x${string}`;
    logSessionAge("quests/daily/voucher", addr, session.issuedAt);

    if (await isBlacklisted(addr, "quests/daily")) {
      return Response.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const quest = getQuest("daily_checkin");
    const today = new Date().toISOString().slice(0, 10);

    // On-chain activity gate — must run before the DB lock so we don't
    // permanently block a user who just fails this check today.
    let txCount: number;
    try {
      txCount = await getCeloTxCount(addr);
    } catch {
      return Response.json(
        { success: false, message: "Could not verify wallet activity. Please try again." },
        { status: 503 }
      );
    }

    if (txCount < MIN_LIFETIME_TXS) {
      return Response.json(
        { success: false, code: "insufficient-activity", message: "Do anything on Celo today to claim." },
        { status: 403 }
      );
    }

    // ── Atomic DB lock ────────────────────────────────────────────────────────
    // Insert the engagement row now. If it conflicts (unique constraint), the
    // user already has a voucher or confirmed claim for today — reject cleanly.
    const { error: insertError } = await supabase
      .from("daily_engagements")
      .insert({
        user_address: addr,
        quest_id:     quest.questId,
        claimed_at:   today,
        source:       "onchain_pending",
      });

    if (insertError) {
      if (insertError.code === "23505") {
        // Unique constraint violation — already claimed (or voucher already issued)
        return Response.json(
          { success: false, code: "already", message: "Already claimed today" },
          { status: 200 }
        );
      }
      console.error("[daily-voucher] DB insert error:", insertError);
      return Response.json({ success: false, message: "Database error" }, { status: 500 });
    }
    // ── DB row exists — now safe to sign ─────────────────────────────────────

    const voucher = await signDailyQuestVoucher({ user: addr, amountMiles: quest.points });

    return Response.json({ success: true, ...voucher, points: quest.points }, { status: 200 });
  } catch (err: any) {
    console.error("[daily-voucher]", err);
    return Response.json({ success: false, message: err?.message ?? "Error" }, { status: 500 });
  }
}
