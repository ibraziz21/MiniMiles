// app/api/users/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoAlfajores } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CONTRACT_ADDRESS = "0x9a51F81DAcEB772cC195fc8551e7f2fd7c62CD57";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain: celoAlfajores, transport: http() });
const walletClient = createWalletClient({ account, chain: celoAlfajores, transport: http() });

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { userAddress } = body as { userAddress?: string };
  if (!userAddress) {
    return NextResponse.json({ error: "userAddress is required" }, { status: 400 });
  }

  // 1) Mint 100 MiniMiles on-chain
  try {
    const { request: txRequest } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("100", 18)],
      account: account
    });
    await walletClient.writeContract(txRequest);
  } catch (err) {
    console.error("Minting failed", err);
    return NextResponse.json({ success: false, error: "Error minting points" }, { status: 500 });
  }

  // 2) Upsert the user as a member in Supabase
  const { error: dbErr } = await supabase
    .from("users")
    .upsert({ user_address: userAddress, is_member: true }, { onConflict: "user_address" });

  if (dbErr) {
    console.error("DB upsert failed", dbErr);
    return NextResponse.json({ success: false, error: "Could not mark member" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
