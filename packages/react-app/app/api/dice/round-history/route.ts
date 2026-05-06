import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createPublicClient, http } from "viem";
import { createClient } from "@supabase/supabase-js";
import diceAbi from "@/contexts/akibadice.json";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";
const HISTORY_DEPTH = 5;

const USD_TIERS = [250, 500, 1000] as const;

function potValue(tier: number): { miles: number; usdt: number } {
  if ((USD_TIERS as readonly number[]).includes(tier as any)) {
    const payouts: Record<number, { miles: number; usdt: number }> = {
      250:  { miles: 100, usdt: 1.00 },
      500:  { miles: 200, usdt: 2.00 },
      1000: { miles: 300, usdt: 3.00 },
    };
    return payouts[tier] ?? { miles: 0, usdt: 0 };
  }
  return { miles: tier * 6, usdt: tier === 30 ? 0.10 : 0 };
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

function getPublicClient() {
  return createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tierParam = searchParams.get("tier");
  if (!tierParam) return NextResponse.json({ error: "Missing tier" }, { status: 400 });

  const tier = Number(tierParam);
  if (isNaN(tier)) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });

  try {
    const client = getPublicClient();

    const activeId = (await client.readContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      functionName: "getActiveRoundId",
      args: [BigInt(tier)],
    })) as bigint;

    if (activeId <= 1n) return NextResponse.json({ rounds: [] });

    // Walk backwards from activeId-1 collecting resolved rounds
    const rounds: Array<{
      roundId: string;
      winningNumber: number;
      winner: string;
      displayName: string;
      pot: { miles: number; usdt: number };
    }> = [];

    let rid = activeId - 1n;
    while (rid > 0n && rounds.length < HISTORY_DEPTH) {
      const [tierOnChain, , winnerSelected, winningNumber, , winner] = (await client.readContract({
        abi: diceAbi.abi,
        address: DICE_ADDRESS,
        functionName: "getRoundInfo",
        args: [rid],
      })) as [bigint, number, boolean, number, bigint, `0x${string}`];

      // Only include rounds that belong to this tier and are resolved
      if (
        Number(tierOnChain) === tier &&
        winnerSelected &&
        winningNumber !== 0 &&
        winner &&
        winner.toLowerCase() !== ZERO_ADDR
      ) {
        rounds.push({
          roundId: rid.toString(),
          winningNumber: Number(winningNumber),
          winner,
          displayName: "",
          pot: potValue(tier),
        });
      }
      rid--;
    }

    // Batch-fetch usernames
    if (supabase && rounds.length > 0) {
      const addresses = [...new Set(rounds.map((r) => r.winner.toLowerCase()))];
      const { data } = await supabase
        .from("users")
        .select("user_address, username")
        .in("user_address", addresses);
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.username) map[row.user_address] = row.username;
      }
      for (const r of rounds) {
        r.displayName = map[r.winner.toLowerCase()] ?? "";
      }
    }

    return NextResponse.json({ rounds });
  } catch (err: any) {
    console.error("[dice/round-history]", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
