/**
 * GET /api/games/status?wallet=0x...&gameType=rule_tap
 *
 * Returns the player's current credit balance, plays used today,
 * plays remaining today, and the next startGame nonce — sourced directly
 * from the contract so the frontend never trusts localStorage for cap enforcement.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { akibaSkillGamesAbi, AKIBA_SKILL_GAMES_ADDRESS } from "@/lib/games/contracts";
import { GAME_CONFIGS } from "@/lib/games/config";
import type { GameType } from "@/lib/games/types";

const publicClient = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

const GAME_TYPE_ID: Record<GameType, number> = { rule_tap: 1, memory_flip: 2 };

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const wallet   = searchParams.get("wallet")   as `0x${string}` | null;
  const gameType = searchParams.get("gameType") as GameType | null;

  if (!wallet || !gameType || !GAME_CONFIGS[gameType]) {
    return NextResponse.json({ error: "wallet and gameType required" }, { status: 400 });
  }

  if (!AKIBA_SKILL_GAMES_ADDRESS) {
    // Contract not deployed — return mock values so the UI still works
    return NextResponse.json({ credits: 0, playsToday: 0, playsRemaining: 20, nonce: 0, contractAvailable: false });
  }

  try {
    const chainId = GAME_TYPE_ID[gameType];

    const [statusResult, nonceResult] = await Promise.all([
      publicClient.readContract({
        address: AKIBA_SKILL_GAMES_ADDRESS,
        abi: akibaSkillGamesAbi,
        functionName: "playerStatus",
        args: [wallet, chainId],
      }),
      publicClient.readContract({
        address: AKIBA_SKILL_GAMES_ADDRESS,
        abi: akibaSkillGamesAbi,
        functionName: "startNonces",
        args: [wallet],
      }),
    ]);

    const [credits, playsToday, playsRemaining] = statusResult as [bigint, bigint, bigint];
    const nonce = nonceResult as bigint;

    return NextResponse.json({
      credits:        Number(credits),
      playsToday:     Number(playsToday),
      playsRemaining: Number(playsRemaining),
      nonce:          Number(nonce),
      contractAvailable: true,
    });
  } catch (err) {
    console.error("[games/status]", err);
    return NextResponse.json({ error: "contract-read-failed" }, { status: 502 });
  }
}
