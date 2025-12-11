// src/lib/minipoints.ts
import { getReferralTag, submitReferral } from "@divvi/referral-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import MiniPointsAbi from "@/contexts/minimiles.json";

/* ─── viem / wallet setup ───────────────────────────────── */

const account = privateKeyToAccount(`0x${process.env.BADGES_RELAYER_KEY!}`);


const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

// You can keep these hard-coded or move to envs if you like
const CONTRACT_ADDRESS = (
  process.env.MINIPOINTS_ADDRESS ??
  "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b"
) as `0x${string}`;

const DIVVI_CONSUMER = (
  process.env.DIVVI_CONSUMER ??
  "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d"
) as `0x${string}`;

/* ─── Exported helper with nonce/gas race retries ───────── */

export async function safeMintMiniPoints(params: {
  to: `0x${string}`;
  points: number;
  reason?: string; // optional for logging: "username-quest", etc
}): Promise<`0x${string}`> {
  const { to, points, reason } = params;

  const referralTag = getReferralTag({
    user: account.address as `0x${string}`,
    consumer: DIVVI_CONSUMER,
  });

  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Always grab the latest pending nonce to avoid races
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });

      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MiniPointsAbi.abi,
        functionName: "mint",
        args: [to, parseUnits(points.toString(), 18)],
        account,
        dataSuffix: `0x${referralTag}`,
        nonce,
      });

      // Fire-and-forget Divvi attribution
      submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
        console.error("[safeMintMiniPoints] Divvi submitReferral failed", e),
      );

      return txHash as `0x${string}`;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.shortMessage || err?.message || "").toLowerCase();

      const isNonceOrGasRace =
        msg.includes("nonce too low") ||
        msg.includes("replacement transaction underpriced");

      if (!isNonceOrGasRace) {
        // some other error → don't hide it
        throw err;
      }

      console.warn(
        `[safeMintMiniPoints] nonce/gas race${
          reason ? ` for ${reason}` : ""
        } on attempt ${attempt + 1}, retrying…`,
        msg,
      );

      // tiny jitter to de-sync concurrent requests from the same wallet
      await new Promise((r) =>
        setTimeout(r, 150 + Math.random() * 250),
      );
    }
  }

  throw lastError ?? new Error("mint failed after nonce/gas retries");
}

/* ─── Mirrored helper for burning MiniPoints ────────────── */

export async function safeBurnMiniPoints(params: {
  from: `0x${string}`;     // user whose points are being burned
  points: number;
  reason?: string;         // optional for logging: "prosperity-pass", etc
}): Promise<`0x${string}`> {
  const { from, points, reason } = params;

  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Always grab the latest pending nonce to avoid races
      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });

      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MiniPointsAbi.abi,
        functionName: "burn", // assumes signature: burn(address,uint256)
        args: [from, parseUnits(points.toString(), 18)],
        account,
        nonce,
      });

      console.info(
        `[safeBurnMiniPoints] Burned ${points} MiniPoints from ${from}${
          reason ? ` for ${reason}` : ""
        }. txHash=${txHash}`,
      );

      return txHash as `0x${string}`;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.shortMessage || err?.message || "").toLowerCase();

      const isNonceOrGasRace =
        msg.includes("nonce too low") ||
        msg.includes("replacement transaction underpriced");

      if (!isNonceOrGasRace) {
        // some other error → don't hide it
        throw err;
      }

      console.warn(
        `[safeBurnMiniPoints] nonce/gas race${
          reason ? ` for ${reason}` : ""
        } on attempt ${attempt + 1}, retrying…`,
        msg,
      );

      await new Promise((r) =>
        setTimeout(r, 150 + Math.random() * 250),
      );
    }
  }

  throw lastError ?? new Error("burn failed after nonce/gas retries");
}
