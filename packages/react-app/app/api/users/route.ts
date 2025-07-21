// app/api/users/route.ts
import { NextResponse } from "next/server";
import {
  createClient
} from "@supabase/supabase-js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

export async function POST(req: Request) {
  const { userAddress } = await req.json().catch(() => ({}));
  const address = (userAddress as string | undefined)?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "userAddress is required" }, { status: 400 });
  }

  // 1) fetch membership row
  const { data, error } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (data?.is_member) {
    return NextResponse.json({ success: true, already: true });
  }

  // 2) mint (on‑chain) – will revert if already minted
  try {
    const { request: txRequest } = await publicClient.simulateContract({
      address: process.env.MINIPOINTS_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [address, parseUnits("100", 18)],
      account,
    });
    await walletClient.writeContract(txRequest);
  } catch (e) {
    console.error("mint failed:", e);
    return NextResponse.json({ error: "Mint failed" }, { status: 500 });
  }

  // 3) mark as member
  const { error: upErr } = await supabase
    .from("users")
    .update({ is_member: true })
    .eq("user_address", address);

  if (upErr) {
    console.error(upErr);
    // optional: you might refund / rollback, but token mint is irreversible
  }

  return NextResponse.json({ success: true, already: false });
}
