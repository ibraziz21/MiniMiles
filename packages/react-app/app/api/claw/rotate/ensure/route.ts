// POST /api/claw/rotate/ensure
// Ensures an active batch exists; used for admin batch management.
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import batchRngAbi from "@/contexts/merkleBatchRng.json";

const BATCH_RNG = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "0x249Ce901411809a8A0fECa6102D9F439bbf3751e") as `0x${string}`;
const RPC_URL   = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

export async function POST(_req: Request) {
  try {
    const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });

    const inv = await pub.readContract({
      address: BATCH_RNG,
      abi: batchRngAbi,
      functionName: "getActiveBatchInventory",
    }) as any;

    return NextResponse.json({
      ok: true,
      batchId: inv.batchId.toString(),
      totalRemaining: inv.totalRemaining.toString(),
      active: inv.active,
      loses: inv.loses.toString(),
      commons: inv.commons.toString(),
      rares: inv.rares.toString(),
      epics: inv.epics.toString(),
      legendarys: inv.legendarys.toString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
