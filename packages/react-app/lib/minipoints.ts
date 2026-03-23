// src/lib/minipoints.ts
import { getReferralTag, submitReferral } from "@divvi/referral-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import MiniPointsAbi from "@/contexts/minimiles.json";

/* ─── viem / wallet setup ───────────────────────────────── */

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`, { nonceManager });

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http("https://forno.celo.org"),
});

function makeClients(privateKey?: string) {
  if (!privateKey) {
    console.log(`[makeClients] No privateKey provided, using default PRIVATE_KEY account: ${account.address}`);
    return { account, walletClient, publicClient };
  }
  const acc = privateKeyToAccount((privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`, { nonceManager });
  console.log(`[makeClients] Using RETRY_PK account: ${acc.address}`);
  return {
    account: acc,
    publicClient,
    walletClient: createWalletClient({ account: acc, chain: celo, transport: http("https://forno.celo.org") }),
  };
}

// You can keep these hard-coded or move to envs if you like
const CONTRACT_ADDRESS = (
  process.env.MINIPOINTS_ADDRESS ??
  "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b"
) as `0x${string}`;

const DIVVI_CONSUMER = (
  process.env.DIVVI_CONSUMER ??
  "0x03909bb1E9799336d4a8c49B74343C2a85fDad9d"
) as `0x${string}`;

function isRetryableNonceOrGasRace(message: string) {
  return (
    message.includes("nonce too low") ||
    message.includes("lower than the current nonce") ||
    message.includes("current nonce") ||
    message.includes("replacement transaction underpriced") ||
    message.includes("already known") ||
    message.includes("transaction with the same hash was already imported")
  );
}

async function writeMiniPointsWithRetries(params: {
  functionName: "mint" | "burn";
  args: readonly unknown[];
  reason?: string;
  attachReferral?: boolean;
  privateKey?: string;
}): Promise<`0x${string}`> {
  const { functionName, args, reason, attachReferral = false, privateKey } = params;
  const clients = makeClients(privateKey);

  const referralTag = attachReferral
    ? getReferralTag({
        user: clients.account.address as `0x${string}`,
        consumer: DIVVI_CONSUMER,
      })
    : null;

  let lastError: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await new Promise(r => setTimeout(r, attempt * 500));

      const txHash = await clients.walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: MiniPointsAbi.abi,
        functionName,
        args,
        account: clients.account,
        ...(referralTag ? { dataSuffix: `0x${referralTag}` } : {}),
      });

      if (attachReferral) {
        submitReferral({ txHash, chainId: publicClient.chain.id }).catch((e) =>
          console.error(`[${functionName}MiniPoints] Divvi submitReferral failed`, e),
        );
      }

      return txHash as `0x${string}`;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.shortMessage || err?.message || "").toLowerCase();

      if (!isRetryableNonceOrGasRace(msg)) {
        throw err;
      }

      console.warn(
        `[${functionName}MiniPoints] nonce/gas race${
          reason ? ` for ${reason}` : ""
        } on attempt ${attempt + 1}, retrying…`,
        msg,
      );

      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
    }
  }

  throw lastError ?? new Error(`${functionName} failed after nonce/gas retries`);
}

/* ─── Exported helper with nonce/gas race retries ───────── */

export async function safeMintMiniPoints(params: {
  to: `0x${string}`;
  points: number;
  reason?: string;
  privateKey?: string;
}): Promise<`0x${string}`> {
  const { to, points, reason, privateKey } = params;
  return writeMiniPointsWithRetries({
    functionName: "mint",
    args: [to, parseUnits(points.toString(), 18)],
    reason,
    attachReferral: true,
    privateKey,
  });
}

export async function safeMintRefund(params: {
  to: `0x${string}`;
  points: number;
  reason?: string;
}): Promise<`0x${string}`> {
  return safeMintMiniPoints(params);
}

export async function safeBurnMiniPoints(params: {
  from: `0x${string}`;
  points: number;
  reason?: string;
}): Promise<`0x${string}`> {
  const { from, points, reason } = params;
  return writeMiniPointsWithRetries({
    functionName: "burn",
    args: [from, parseUnits(points.toString(), 18)],
    reason,
    attachReferral: false,
  });
}
