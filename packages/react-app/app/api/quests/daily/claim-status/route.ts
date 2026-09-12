// app/api/quests/daily/claim-status/route.ts
//
// GET /api/quests/daily/claim-status — reconciles and returns today's claim
// status for the session wallet (docs/daily-checkin-self-claim-spec.md §6).
// The client polls this after broadcasting so a closed browser can never
// orphan a successful claim.

import { requireSession } from "@/lib/auth";
import { getQuest } from "@/lib/questRegistry";
import { getUtcDayContext } from "@/lib/dailyQuestClaimer";
import { getIntentById, getIntentForDay, reconcileIntent } from "@/lib/server/dailyClaimIntents";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }
    const addr = session.walletAddress.toLowerCase();

    // Prefer the opaque intentId from the voucher/confirm response — a
    // transaction broadcast just before UTC midnight can still be polled
    // just after it, once "today" server-side has already rolled over to a
    // different claim_date than the intent was issued for. The date-keyed
    // lookup only runs when no intentId was supplied at all (older clients)
    // — a *supplied-but-unresolved* id must fail closed (reported the same
    // way as "no intent") rather than silently answering with today's
    // unrelated intent.
    const url = new URL(req.url);
    const intentId = url.searchParams.get("intentId");
    // Optional reconciliation hint: the client always resends the hash it
    // broadcast alongside each poll. This makes polling self-healing even if
    // the separate POST /confirm call (which also records this hash) never
    // reached the server — otherwise a poll that lands before that write
    // commits would see the intent's pre-submission "issued" state and
    // misreport a transaction that is merely still pending as failed.
    // Validated with the same rule as POST /confirm — an unvalidated string
    // here would otherwise get written straight onto the intent as its
    // submitted hash.
    const txHashHintRaw = url.searchParams.get("txHash");
    if (txHashHintRaw !== null && !TX_HASH_RE.test(txHashHintRaw)) {
      return json(400, { success: false, message: "txHash must be a 0x-prefixed 32-byte transaction hash" });
    }
    const txHashHint = txHashHintRaw;

    let intent;
    if (intentId !== null) {
      intent = await getIntentById(intentId, addr);
    } else {
      const quest = getQuest("daily_checkin");
      const { claimDate } = getUtcDayContext();
      intent = await getIntentForDay(addr, quest.questId, claimDate);
    }
    if (!intent) {
      return json(200, { success: true, status: "issued", exists: false });
    }

    const reconciled = await reconcileIntent(
      intent,
      txHashHint ? { incomingTxHash: txHashHint } : undefined,
    );

    return json(200, {
      success: true,
      status: reconciled.status,
      exists: true,
      intentId: reconciled.id,
      points: reconciled.points_awarded,
      txHash: reconciled.tx_hash,
      lastError: reconciled.last_error,
    });
  } catch (err: any) {
    console.error("[daily-claim-status] unexpected error", err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}
