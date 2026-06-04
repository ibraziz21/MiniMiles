import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import diceAbi from "@/contexts/akibadice.json";
import { supabase } from "@/lib/supabaseClient";

const DICE_ADDRESS = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a" as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

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

  const account = privateKeyToAccount(
    (RELAYER_PK.startsWith("0x") ? RELAYER_PK : `0x${RELAYER_PK}`) as `0x${string}`
  );

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
    const roundIdBigInt = BigInt(roundId);
    const houseCommit = (await publicClient.readContract({
      abi: diceAbi.abi,
      address: DICE_ADDRESS,
      functionName: "roundHouseCommit",
      args: [roundIdBigInt],
    })) as `0x${string}`;

    let hash: `0x${string}`;
    if (houseCommit !== ZERO_BYTES32) {
      const nonce = (await publicClient.readContract({
        abi: diceAbi.abi,
        address: DICE_ADDRESS,
        functionName: "roundHouseCommitNonce",
        args: [roundIdBigInt],
      })) as bigint;

      const { data, error } = await supabase
        .from("dice_house_commits")
        .select("secret")
        .eq("nonce", nonce.toString())
        .maybeSingle();

      if (error || !data?.secret) {
        return NextResponse.json(
          {
            error: "missing-reveal-secret",
            roundId,
            nonce: nonce.toString(),
            detail: error?.message,
          },
          { status: 500 }
        );
      }

      await supabase
        .from("dice_house_commits")
        .update({
          status: "assigned",
          round_id: roundIdBigInt.toString(),
          assigned_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("nonce", nonce.toString())
        .neq("status", "revealed");

      hash = await walletClient.writeContract({
        abi: diceAbi.abi,
        address: DICE_ADDRESS,
        functionName: "revealAndDraw",
        args: [roundIdBigInt, data.secret as `0x${string}`],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return NextResponse.json(
          { error: "reveal-transaction-failed", roundId, hash },
          { status: 500 }
        );
      }

      await supabase
        .from("dice_house_commits")
        .update({
          status: "revealed",
          round_id: roundIdBigInt.toString(),
          reveal_tx_hash: hash,
          revealed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("nonce", nonce.toString());
    } else {
      hash = await walletClient.writeContract({
        abi: diceAbi.abi,
        address: DICE_ADDRESS,
        functionName: "drawRound",
        args: [roundIdBigInt],
      });
    }

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
