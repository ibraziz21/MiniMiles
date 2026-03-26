// app/api/migrate/claim-v2/route.ts
//
// Backend-signed V1 → V2 migration.
// The backend wallet calls claimV2TokensFor(user) so the user never
// needs to sign or pay gas — no MiniPay contract-whitelist friction.

import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
} from "viem";
import { celo } from "viem/chains";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { isBlacklisted } from "@/lib/blacklist";

const V1_ADDRESS = (
  process.env.MINIPOINTS_ADDRESS ?? "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b"
) as `0x${string}`;

const V2_ADDRESS = process.env.MINIPOINTS_V2_ADDRESS as `0x${string}` | undefined;

const V2_ABI = [
  {
    name: "claimV2TokensFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function POST(req: Request) {
  if (!V2_ADDRESS) {
    console.error("[migrate/claim-v2] MINIPOINTS_V2_ADDRESS not set");
    return NextResponse.json({ error: "Migration not available" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const addr = (body.address as string | undefined)?.toLowerCase();

  if (!addr) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  if (await isBlacklisted(addr, "migrate/claim-v2")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`, {
    nonceManager,
  });

  const publicClient = createPublicClient({
    chain: celo,
    transport: http("https://forno.celo.org"),
  });

  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http("https://forno.celo.org"),
  });

  // Check V1 balance before calling — gives a clean error instead of
  // letting the contract revert with "No V1 balance to claim".
  const v1Balance = await publicClient.readContract({
    address: V1_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [addr as `0x${string}`],
  });

  if (v1Balance === 0n) {
    return NextResponse.json(
      { error: "No V1 balance to migrate" },
      { status: 400 }
    );
  }

  try {
    const txHash = await walletClient.writeContract({
      address: V2_ADDRESS,
      abi: V2_ABI,
      functionName: "claimV2TokensFor",
      args: [addr as `0x${string}`],
      account,
    });

    return NextResponse.json({
      ok: true,
      txHash,
      amount: formatUnits(v1Balance, 18),
    });
  } catch (err: any) {
    console.error("[migrate/claim-v2] contract error:", err?.shortMessage ?? err?.message);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
