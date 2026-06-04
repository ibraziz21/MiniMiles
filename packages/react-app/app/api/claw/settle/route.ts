// POST /api/claw/settle
// Relayer: assigns a batch play (if not already assigned), derives outcome
// from the server-only batch store, commits Merkle proof, and claims reward.
//
// Outcome material (reward_class, merkle_proof) is NEVER read from or
// written to Supabase — it lives exclusively in the server-only batch store.
// Supabase only holds (session_id, batch_id, play_index, commit_status).
//
// Auth: caller must supply ownershipSig — an eth_sign of sessionId (as a string)
// by the session player's wallet. We recover the signer and verify it matches
// the on-chain session.player before spending any relayer gas.

import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { getClients, settleSession, logSettle } from "@/lib/server/clawAssign";
import clawAbi from "@/contexts/akibaClawGame.json";

const RELAYER_PK = process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "";
const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;

export async function POST(req: Request) {
  let sessionIdStr = "";
  try {
    const body = await req.json();
    sessionIdStr = String(body.sessionId ?? "");
    const ownershipSig = body.ownershipSig as string | undefined;

    if (!sessionIdStr || sessionIdStr === "0") {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    if (!ownershipSig) {
      return NextResponse.json({ error: "ownershipSig required" }, { status: 400 });
    }
    if (!RELAYER_PK || RELAYER_PK.length < 10) {
      return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
    }

    const sessionId = BigInt(sessionIdStr);
    const { pub, wal, account } = getClients();

    // Verify the caller owns the session before spending relayer gas
    const session = await pub.readContract({
      address: CLAW_GAME,
      abi: clawAbi.abi,
      functionName: "getSession",
      args: [sessionId],
    }) as any;

    const onchainPlayer: string = session.player ?? session[1] ?? "";
    const sigValid = await verifyMessage({
      address: onchainPlayer as `0x${string}`,
      message: sessionIdStr,
      signature: ownershipSig as `0x${string}`,
    });

    if (!sigValid) {
      await logSettle(sessionIdStr, "auth", "ownership sig mismatch", false);
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

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
