import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createWalletClient, http } from "viem";
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

export async function POST(req: Request) {
  try {
    const { roundId } = await req.json();

    if (!roundId && roundId !== 0) {
      return NextResponse.json(
        { error: "roundId is required" },
        { status: 400 }
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
