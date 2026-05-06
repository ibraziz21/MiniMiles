import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import diceAbi from "@/contexts/akibadice.json";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;

const RELAYER_PK = process.env.CELO_RELAYER_PK;
const CELO_RPC_URL =
  process.env.CELO_RPC_URL || "https://forno.celo.org";
const WITNET_FEE_WEI = BigInt(process.env.WITNET_FEE_WEI || parseUnits("0.01", 18));

if (!RELAYER_PK) {
  console.warn(
    "[dice/request-randomness] CELO_RELAYER_PK not set – this route will fail"
  );
}

function getWalletClient() {
  if (!RELAYER_PK) throw new Error("Relayer PK not configured");

  const account = privateKeyToAccount(`0x${RELAYER_PK}`);

  return createWalletClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
    account,
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
  });
}

export async function POST(req: Request) {
  try {
    const { roundId } = await req.json();

    if (!roundId && roundId !== 0) {
      return NextResponse.json(
        { error: "roundId is required" },
        { status: 400 }
      );
    }

    const publicClient = getPublicClient();
    const [tier, filledSlots, winnerSelected, , randomBlock] =
      (await publicClient.readContract({
        abi: diceAbi.abi,
        address: DICE_ADDRESS,
        functionName: "getRoundInfo",
        args: [BigInt(roundId)],
      })) as [bigint, number, boolean, number, bigint, `0x${string}`];

    if (winnerSelected) {
      return NextResponse.json(
        { ok: true, skipped: "already-resolved", roundId, tier: tier.toString() },
        { status: 200 }
      );
    }

    if (Number(filledSlots) === 0) {
      return NextResponse.json(
        { ok: true, skipped: "no-players", roundId, tier: tier.toString() },
        { status: 200 }
      );
    }

    if (randomBlock !== 0n) {
      return NextResponse.json(
        {
          ok: true,
          skipped: "already-requested",
          roundId,
          tier: tier.toString(),
          randomBlock: randomBlock.toString(),
        },
        { status: 200 }
      );
    }

    const walletClient = getWalletClient();

    const hash = await walletClient.writeContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      functionName: "requestRoundRandomness",
      args: [BigInt(roundId)],
      value: WITNET_FEE_WEI, // adjust in env for Witnet fee
    });

    return NextResponse.json({ hash }, { status: 200 });
  } catch (err: any) {
    console.error("[dice/request-randomness] Error:", err);
    return NextResponse.json(
      {
        error: err?.shortMessage || err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
