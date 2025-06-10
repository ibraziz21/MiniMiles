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
import { celo } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CONTRACT_ADDRESS = "0xb0012Ff26b6eB4F75d09028233204635c0332050";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { userAddress } = body as { userAddress?: string };
  if (!userAddress) {
    return NextResponse.json({ error: "userAddress is required" }, { status: 400 });
  }

    /* ── Already a member? ───────────────────────────────── */
    const { data } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", userAddress)
    .maybeSingle();                       // ← returns null if no row

  if (data?.is_member) {
    // nothing to mint, just exit
    return NextResponse.json({ success: true, already: true });
  }

  /* ── Mint 100 MiniMiles (first-time only) ────────────── */
  try {
    const { request: txReq } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi:      MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("100", 18)],
      account
    });
    await walletClient.writeContract(txReq);
  } catch (err) {
    console.error("mint failed:", err);
    return NextResponse.json({ error: "Minting failed" }, { status: 500 });
  }

  /* ── write flag ─────────────────────────────────────── */
  const { error } = await supabase
    .from("users")
    .upsert({ user_address: userAddress, is_member: true }, { onConflict: "user_address" });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, already: false });
}