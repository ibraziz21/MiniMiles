/**
 * POST /api/games/start-intent
 *
 * Backend-sponsored game start. The player has prepaid credits and signs an
 * intent off-chain. The backend verifier wallet calls startGameFor() so the
 * player pays zero gas for the start transaction.
 *
 * Body:
 *   {
 *     gameType: "rule_tap" | "memory_flip",
 *     walletAddress: "0x...",
 *     seedCommitment: "0x...",   // bytes32 chosen client-side
 *     nonce: number,             // from /api/games/status
 *     expiry: number,            // unix timestamp (recommend now + 5min)
 *     playerSignature: "0x...",  // signed intent from client wallet
 *   }
 *
 * Returns:
 *   { sessionId: string, txHash: string }
 *
 * The returned sessionId is the on-chain uint256 emitted in GameStarted.
 * The client uses this to build the replay and call /api/games/verify.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient,
  http, decodeEventLog,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { akibaSkillGamesAbi, AKIBA_SKILL_GAMES_ADDRESS } from "@/lib/games/contracts";
import { GAME_CONFIGS } from "@/lib/games/config";
import type { GameType } from "@/lib/games/types";

const VERIFIER_PK    = process.env.SKILL_GAMES_VERIFIER_PK as `0x${string}` | undefined;
const CELO_RPC       = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const GAME_TYPE_ID: Record<GameType, number> = { rule_tap: 1, memory_flip: 2 };

export async function POST(req: NextRequest) {
  if (!VERIFIER_PK || !AKIBA_SKILL_GAMES_ADDRESS) {
    return NextResponse.json({ error: "backend-not-configured" }, { status: 503 });
  }

  let body: {
    gameType: GameType;
    walletAddress: string;
    seedCommitment: `0x${string}`;
    nonce: number;
    expiry: number;
    playerSignature: `0x${string}`;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { gameType, walletAddress, seedCommitment, nonce, expiry, playerSignature } = body;

  if (!gameType || !walletAddress || !seedCommitment || nonce == null || !expiry || !playerSignature) {
    return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  }
  if (!GAME_CONFIGS[gameType]) {
    return NextResponse.json({ error: "unknown-game-type" }, { status: 400 });
  }
  if (Date.now() / 1000 > expiry) {
    return NextResponse.json({ error: "intent-expired" }, { status: 400 });
  }

  const account       = privateKeyToAccount(VERIFIER_PK);
  const publicClient  = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const walletClient  = createWalletClient({ chain: celo, transport: http(CELO_RPC), account });

  try {
    const hash = await walletClient.writeContract({
      chain: celo,
      account,
      address: AKIBA_SKILL_GAMES_ADDRESS,
      abi: akibaSkillGamesAbi,
      functionName: "startGameFor",
      args: [
        walletAddress as `0x${string}`,
        GAME_TYPE_ID[gameType],
        seedCommitment,
        BigInt(nonce),
        BigInt(expiry),
        playerSignature,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });

    // Parse GameStarted to extract on-chain sessionId
    let sessionId: string | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: akibaSkillGamesAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "GameStarted") {
          sessionId = (decoded.args as any).sessionId.toString();
          break;
        }
      } catch { /* not our log */ }
    }

    if (!sessionId) {
      return NextResponse.json({ error: "session-id-not-found-in-receipt" }, { status: 500 });
    }

    return NextResponse.json({ sessionId, txHash: hash });
  } catch (err: any) {
    console.error("[games/start-intent]", err);
    // Surface chain revert messages clearly
    const msg: string = err?.shortMessage ?? err?.message ?? "contract-error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
