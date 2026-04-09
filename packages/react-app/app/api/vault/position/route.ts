// GET /api/vault/position
// Returns the signed-in wallet's current vault position and daily Miles rate.
//
// Primary source: vault_positions table (maintained by event watcher).
// Fallback: reads akUSDT.balanceOf() on-chain if no DB record exists.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { createPublicClient, http, formatUnits } from "viem";
import { celo } from "viem/chains";

const AKUSDT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_SHARE_TOKEN_ADDRESS ?? ""
) as `0x${string}`;

const VAULT_REWARD_MULTIPLIER = Number(process.env.VAULT_REWARD_MULTIPLIER ?? "1");

const akUsdtAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function getOnChainBalance(address: string): Promise<string> {
  try {
    const client = createPublicClient({ chain: celo, transport: http() });
    const raw = await client.readContract({
      address: AKUSDT_ADDRESS,
      abi: akUsdtAbi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    return formatUnits(raw as bigint, 6);
  } catch {
    return "0";
  }
}

async function getLifetimeMilesEarned(wallet: string): Promise<number> {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("points")
    .eq("user_address", wallet)
    .eq("status", "completed")
    .like("reason", "vault-daily-reward:%");

  if (error) {
    console.error("[vault/position] lifetime reward read error", error);
    return 0;
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.points ?? 0), 0);
}

export async function GET(_req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const wallet = session.walletAddress.toLowerCase();

  // Try DB first
  const { data, error } = await supabase
    .from("vault_positions")
    .select("balance_usdt, updated_at")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (error) {
    console.error("[vault/position] DB error", error);
    return Response.json({ error: "db-error" }, { status: 500 });
  }

  let balanceUsdt: string;

  if (data && Number(data.balance_usdt) > 0) {
    balanceUsdt = data.balance_usdt;
  } else {
    // Fallback to on-chain read
    balanceUsdt = await getOnChainBalance(wallet);
  }

  const balance = parseFloat(balanceUsdt);
  const milesPerDay = Math.floor(balance * VAULT_REWARD_MULTIPLIER);
  const lifetimeMilesEarned = await getLifetimeMilesEarned(wallet);

  return Response.json({
    balance: balanceUsdt,
    milesPerDay,
    lifetimeMilesEarned,
    updatedAt: data?.updated_at ?? null,
  });
}
