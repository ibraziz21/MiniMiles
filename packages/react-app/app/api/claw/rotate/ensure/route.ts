// POST /api/claw/rotate/ensure
// Ensures an active batch exists; used for admin batch management.
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import batchRngAbi from "@/contexts/merkleBatchRng.json";
import { hasBatchManifest, isBatchStoreConfigured } from "@/lib/server/clawBatchStore";

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

    const batchId = (inv.batchId ?? inv[0]).toString();

    return NextResponse.json({
      ok: true,
      batchId,
      loses: (inv.loses ?? inv[1]).toString(),
      commons: (inv.commons ?? inv[2]).toString(),
      rares: (inv.rares ?? inv[3]).toString(),
      epics: (inv.epics ?? inv[4]).toString(),
      legendarys: (inv.legendarys ?? inv[5]).toString(),
      totalRemaining: (inv.totalRemaining ?? inv[6]).toString(),
      active: Boolean(inv.active ?? inv[8]),
      manifestConfigured: isBatchStoreConfigured(),
      manifestReady: await hasBatchManifest(batchId),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
