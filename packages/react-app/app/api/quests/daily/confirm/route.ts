// app/api/quests/daily/confirm/route.ts
//
// POST /api/quests/daily/confirm — records the transaction hash broadcast by
// the user's wallet and attempts immediate reconciliation
// (docs/daily-checkin-self-claim-spec.md §6). A submitted hash is untrusted
// until reconciliation verifies it on-chain.

import { requireSession } from "@/lib/auth";
import { getQuest } from "@/lib/questRegistry";
import { getUtcDayContext } from "@/lib/dailyQuestClaimer";
import {
  getIntentById,
  getIntentForDay,
  markIntentSubmitted,
  reconcileIntent,
} from "@/lib/server/dailyClaimIntents";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }
    const addr = session.walletAddress.toLowerCase();

    let body: { txHash?: unknown; intentId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { success: false, message: "Invalid JSON body" });
    }

    const txHash = body?.txHash;
    if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
      return json(400, { success: false, message: "txHash must be a 0x-prefixed 32-byte transaction hash" });
    }

    // Prefer the opaque intentId the voucher response carried: a transaction
    // broadcast just before UTC midnight can confirm just after it, and by
    // then "today" server-side is a different claim_date than the intent was
    // issued for. Looking the intent up by id (scoped to this wallet) avoids
    // that race. The date-keyed lookup only runs when no intentId was
    // supplied at all (older clients) — a *supplied-but-unresolved* id must
    // fail closed rather than silently falling through to today's intent,
    // which could otherwise associate this hash with a different claim than
    // the one the client actually meant to confirm.
    if (body?.intentId !== undefined && typeof body.intentId !== "string") {
      return json(400, { success: false, message: "intentId must be a UUID string" });
    }
    const intentId = typeof body?.intentId === "string" ? body.intentId : null;

    let intent;
    if (intentId !== null) {
      intent = await getIntentById(intentId, addr);
      if (!intent) {
        return json(404, { success: false, message: "No claim found for that id." });
      }
    } else {
      const quest = getQuest("daily_checkin");
      const { claimDate } = getUtcDayContext();
      intent = await getIntentForDay(addr, quest.questId, claimDate);
    }
    if (!intent) {
      return json(404, { success: false, message: "No claim in progress for today. Request a voucher first." });
    }

    if (intent.status !== "confirmed" && intent.tx_hash !== txHash) {
      intent = await markIntentSubmitted(intent, txHash);
    }

    intent = await reconcileIntent(intent, { incomingTxHash: txHash });

    if (intent.status === "confirmed") {
      return json(200, {
        success: true,
        status: "confirmed",
        intentId: intent.id,
        points: intent.points_awarded,
        txHash: intent.tx_hash,
      });
    }
    if (intent.status === "submitted") {
      return json(200, { success: true, status: "submitted", intentId: intent.id });
    }

    return json(200, {
      success: false,
      status: intent.status,
      intentId: intent.id,
      code: "reverted",
      message: intent.last_error ?? "Transaction failed. You can try again today.",
    });
  } catch (err: any) {
    console.error("[daily-confirm] unexpected error", err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}
