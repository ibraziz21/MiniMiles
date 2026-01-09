import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import diceAbi from "@/contexts/akibadice.json";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;

const RELAYER_PK = process.env.CELO_RELAYER_PK;
const CELO_RPC_URL =
  process.env.CELO_RPC_URL || "https://forno.celo.org";

if (!RELAYER_PK) {
  console.warn(
    "[dice/draw] CELO_RELAYER_PK not set – this route will fail"
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
    const rawState = (await publicClient.readContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      functionName: "getRoundState",
      args: [BigInt(roundId)],
    })) as bigint | number | string;
    const stateNum = Number(rawState);

    if (stateNum !== 3) {
      const reason =
        stateNum === 2
          ? "randomness-pending"
          : stateNum === 4
          ? "already-resolved"
          : "not-ready";
      return NextResponse.json(
        { error: "round-not-ready", reason },
        { status: 409 }
      );
    }

    const walletClient = getWalletClient();

    const hash = await walletClient.writeContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      functionName: "drawRound",
      args: [BigInt(roundId)],
    });

    return NextResponse.json({ hash }, { status: 200 });
  } catch (err: any) {
    console.error("[dice/draw] Error:", err);
    return NextResponse.json(
      {
        error: err?.shortMessage || err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
