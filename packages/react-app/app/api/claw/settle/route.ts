// POST /api/claw/settle
// Relayer: assigns a batch play (if not already assigned), derives outcome
// from the server-only batch store, commits Merkle proof, and claims reward.
//
// Outcome material (reward_class, merkle_proof) is NEVER read from or
// written to Supabase — it lives exclusively in the server-only batch store.
// Supabase only holds (session_id, batch_id, play_index, commit_status).

import { NextResponse } from "next/server";
import { getClients, settleSession, logSettle } from "@/lib/server/clawAssign";

const RELAYER_PK = process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "";

export async function POST(req: Request) {
  let sessionIdStr = "";
  try {
    const body = await req.json();
    sessionIdStr = String(body.sessionId ?? "");

    if (!sessionIdStr || sessionIdStr === "0") {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    if (!RELAYER_PK || RELAYER_PK.length < 10) {
      return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
    }

    const sessionId = BigInt(sessionIdStr);
    const { pub, wal, account } = getClients();

    const result = await settleSession(sessionId, pub, wal, account);

    if (!result.ok) {
      // Retryable: batch store not ready, no active batch, RPC blip
      // Non-retryable: session legitimately unresolvable
      const status = result.retryable ? 503 : 422;
      return NextResponse.json(
        { error: result.reason, retryable: result.retryable },
        { status }
      );
    }

    return NextResponse.json({
      ok: true,
      ...(result.txHash ? { txHash: result.txHash } : {}),
      ...(result.alreadyClaimed ? { alreadyClaimed: true } : {}),
      rewardClass: result.rewardClass,
      rewardAmount: result.rewardAmount,
      voucherId: result.voucherId,
    });
  } catch (err: any) {
    await logSettle(sessionIdStr, "unexpected", err?.message ?? String(err), false);
    return NextResponse.json(
      { error: "Unexpected error", detail: err?.message },
      { status: 500 }
    );
  }
}
