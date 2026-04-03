import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createPublicClient, http } from "viem";
import { createClient } from "@supabase/supabase-js";
import diceAbi from "@/contexts/akibadice.json";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const MILES_TIERS = [10, 20, 30] as const;
const USD_TIERS = [250, 500, 1000] as const;
const ALL_TIERS = [...MILES_TIERS, ...USD_TIERS];

// Returns structured pot value: miles won + usdt won (0 if none)
function potValue(tier: number): { miles: number; usdt: number } {
  if ((USD_TIERS as readonly number[]).includes(tier)) {
    const payouts: Record<number, { miles: number; usdt: number }> = {
      250:  { miles: 100, usdt: 1.00 },
      500:  { miles: 200, usdt: 2.00 },
      1000: { miles: 300, usdt: 3.00 },
    };
    return payouts[tier] ?? { miles: 0, usdt: 0 };
  }
  const miles = tier * 6;
  const usdt = tier === 30 ? 0.10 : 0;
  return { miles, usdt };
}

function getPublicClient() {
  return createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
}

export async function GET() {
  try {
    const client = getPublicClient();

    // For each tier, fetch the active round and up to 1 previous round
    const wins: Array<{
      roundId: string;
      tier: number;
      winner: string;
      displayName: string;
      winningNumber: number;
      pot: { miles: number; usdt: number };
      resolvedAt: number;
    }> = [];

    await Promise.allSettled(
      ALL_TIERS.map(async (tier) => {
        const activeId = (await client.readContract({
          abi: diceAbi.abi,
          address: DICE_ADDRESS,
          functionName: "getActiveRoundId",
          args: [BigInt(tier)],
        })) as bigint;

        // activeId === 0 means this tier has never had a round
        if (activeId === 0n) return;

        // activeId is the *current* (open/in-progress) round.
        // The most recently *resolved* round is activeId - 1 (if it exists).
        // We never surface activeId itself because it won't have a winner yet.
        const resolvedId = activeId - 1n;
        if (resolvedId <= 0n) return;

        const [, , winnerSelected, winningNumber, , winner] = (await client.readContract({
          abi: diceAbi.abi,
          address: DICE_ADDRESS,
          functionName: "getRoundInfo",
          args: [resolvedId],
        })) as [bigint, number, boolean, number, bigint, `0x${string}`];

        if (
          !winnerSelected ||
          winningNumber === 0 ||
          !winner ||
          winner.toLowerCase() === ZERO_ADDR
        ) return;

        wins.push({
          roundId: resolvedId.toString(),
          tier,
          winner,
          displayName: "", // filled in below
          winningNumber: Number(winningNumber),
          pot: potValue(tier),
          resolvedAt: Number(resolvedId),
        });
      })
    );

    // Batch-fetch usernames from Supabase for all unique winner addresses
    if (supabase && wins.length > 0) {
      const addresses = [...new Set(wins.map((w) => w.winner.toLowerCase()))];
      const { data } = await supabase
        .from("users")
        .select("user_address, username")
        .in("user_address", addresses);

      const usernameMap: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.username) usernameMap[row.user_address] = row.username;
      }

      for (const w of wins) {
        w.displayName = usernameMap[w.winner.toLowerCase()] ?? "";
      }
    }

    // Sort by most recently resolved (highest roundId) and return up to 10
    wins.sort((a, b) => b.resolvedAt - a.resolvedAt);
    return NextResponse.json({ wins: wins.slice(0, 10) });
  } catch (err: any) {
    console.error("[dice/recent-wins]", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
