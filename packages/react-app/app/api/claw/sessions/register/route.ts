// POST /api/claw/sessions/register
// Registers a self-started Claw session in the app-owned session index.
// The chain remains the source of truth; this route only records the ID.

import { NextResponse } from "next/server";
import { createPublicClient, decodeEventLog, http } from "viem";
import { celo } from "viem/chains";
import { requireSession } from "@/lib/auth";
import clawAbi from "@/contexts/akibaClawGame.json";
import { assignBatchPlay } from "@/lib/server/clawAssign";
import {
  CLAW_SESSIONS_SETUP_MESSAGE,
  isClawSessionsSetupError,
  upsertClawSession,
} from "@/lib/server/clawSessions";

const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

type StartedEvent = {
  sessionId: bigint;
  player: `0x${string}`;
  tierId: number;
};

function getSessionField(raw: any, name: string, index: number) {
  return raw?.[name] ?? raw?.[index];
}

export async function POST(req: Request) {
  try {
    const appSession = await requireSession();
    if (!appSession) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const txHash = typeof body.txHash === "string" ? body.txHash : "";
    const providedSessionId = body.sessionId ? String(body.sessionId) : "";

    if (txHash && !HASH_RE.test(txHash)) {
      return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
    }
    if (!txHash && (!providedSessionId || providedSessionId === "0")) {
      return NextResponse.json({ error: "txHash or sessionId required" }, { status: 400 });
    }

    const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });
    let started: StartedEvent | null = null;

    if (txHash) {
      const receipt = await pub.getTransactionReceipt({ hash: txHash as `0x${string}` });
      if (receipt.status !== "success") {
        return NextResponse.json({ error: "Transaction did not succeed" }, { status: 422 });
      }

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== CLAW_GAME.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: clawAbi.abi,
            eventName: "GameStarted",
            data: log.data,
            topics: log.topics,
          }) as any;
          const args = decoded.args as any;
          const player = args.player as `0x${string}`;
          if (player?.toLowerCase() !== appSession.walletAddress.toLowerCase()) continue;
          started = {
            sessionId: args.sessionId as bigint,
            player,
            tierId: Number(args.tierId),
          };
          break;
        } catch {
          // Ignore unrelated logs in the same receipt.
        }
      }
    }

    if (!started && providedSessionId && providedSessionId !== "0") {
      const sessionId = BigInt(providedSessionId);
      const raw = await pub.readContract({
        address: CLAW_GAME,
        abi: clawAbi.abi,
        functionName: "getSession",
        args: [sessionId],
      }) as any;

      started = {
        sessionId,
        player: getSessionField(raw, "player", 1) as `0x${string}`,
        tierId: Number(getSessionField(raw, "tierId", 2)),
      };
    }

    if (!started) {
      return NextResponse.json({ error: "GameStarted event not found" }, { status: 422 });
    }

    if (started.player.toLowerCase() !== appSession.walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const sessionIdStr = started.sessionId.toString();
    const { row, error } = await upsertClawSession({
      sessionId: sessionIdStr,
      player: started.player,
      tierId: started.tierId,
      txHash: txHash || null,
    });

    if (error) {
      if (isClawSessionsSetupError(error)) {
        return NextResponse.json({
          ok: false,
          setupRequired: true,
          error: CLAW_SESSIONS_SETUP_MESSAGE,
          session: {
            sessionId: sessionIdStr,
            player: started.player.toLowerCase(),
            tierId: started.tierId,
            txHash: txHash || null,
            createdAt: null,
            updatedAt: null,
          },
        }, { status: 202 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const assignment = await assignBatchPlay(sessionIdStr, pub as any).catch((err: any) => ({
      ok: false,
      reason: err?.message ?? "assign_failed",
    }));

    return NextResponse.json({
      ok: true,
      session: row,
      assignment,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
