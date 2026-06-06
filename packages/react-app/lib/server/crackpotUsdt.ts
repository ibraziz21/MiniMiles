// lib/server/crackpotUsdt.ts
// Server-side USDT helpers for CrackPot Version B.
// Entry: relayer calls transferFrom(player → Safe treasury)
// Payout: relayer calls transfer(Safe → winner) via Safe exec
//
// The Safe is a Gnosis Safe. Since the relayer is an owner with threshold=1
// (or we're using a direct EOA treasury), we use a direct ERC-20 transfer
// from the treasury EOA. If the Safe requires multi-sig, payouts must go
// through the Safe SDK — wire that when needed.

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { celo } from "viem/chains";

const USDT_ADDRESS = (
  process.env.NEXT_PUBLIC_USDT_ADDRESS ?? "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
) as `0x${string}`;

// Safe treasury — holds collected USDT entry fees
export const CRACKPOT_TREASURY = (
  process.env.CRACKPOT_TREASURY_ADDRESS ?? "0x7622665217d7FA81Ca06E62C58596d5D38d327B3"
) as `0x${string}`;

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
// Relayer key — used for transferFrom (collect entry) and transfer (pay winner)
const RELAYER_PK = (process.env.PRIVATE_KEY ?? "").replace(/^0x/, "");

const USDT_ABI = [
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

function getClients() {
  if (!RELAYER_PK || RELAYER_PK.length < 10) throw new Error("PRIVATE_KEY not configured");
  const account = privateKeyToAccount(`0x${RELAYER_PK}` as `0x${string}`, { nonceManager });
  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const walletClient = createWalletClient({ account, chain: celo, transport: http(CELO_RPC) });
  return { account, publicClient, walletClient };
}

/** Dollars to USDT micro-units (6 decimals) */
export function usdToUnits(usd: number): bigint {
  return parseUnits(usd.toFixed(6), 6);
}

export function unitsToUsd(units: bigint): number {
  return Number(formatUnits(units, 6));
}

/**
 * Collect entry fee from player into the treasury.
 * Player must have pre-approved the relayer address for at least `amount` USDT.
 */
export async function collectUsdtEntry(params: {
  from: `0x${string}`;
  amountUsd: number;
  reason: string;
}): Promise<`0x${string}`> {
  const { from, amountUsd, reason } = params;
  const { publicClient, walletClient, account } = getClients();
  const amount = usdToUnits(amountUsd);

  // Verify allowance before attempting transferFrom
  const allowance = await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "allowance",
    args: [from, account.address],
  });
  if (allowance < amount) {
    throw new Error(
      `Insufficient USDT allowance: have ${unitsToUsd(allowance).toFixed(4)}, need ${amountUsd}`,
    );
  }

  const hash = await walletClient.writeContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "transferFrom",
    args: [from, CRACKPOT_TREASURY, amount],
  });

  try {
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
  } catch (err: any) {
    const m = String(err?.message ?? "");
    if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
      console.warn(`[crackpotUsdt] collectEntry receipt timeout (${reason}) — proceeding`);
    } else {
      throw err;
    }
  }

  console.log(`[crackpotUsdt] collected $${amountUsd} from ${from} → treasury (${reason}) tx:${hash}`);
  return hash;
}

/**
 * Pay USDT winnings from treasury to winner.
 * Relayer must be an owner of the Safe with sufficient signing power,
 * OR the treasury is a plain EOA controlled by PRIVATE_KEY.
 * Phase 1: treasury is treated as EOA — relayer sends directly.
 */
export async function payUsdtWinner(params: {
  to: `0x${string}`;
  amountUsd: number;
  reason: string;
}): Promise<`0x${string}`> {
  const { to, amountUsd, reason } = params;
  const { publicClient, walletClient } = getClients();
  const amount = usdToUnits(amountUsd);

  // Verify treasury balance
  const bal = await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: [CRACKPOT_TREASURY],
  });
  if (bal < amount) {
    throw new Error(
      `Treasury balance too low: have $${unitsToUsd(bal).toFixed(4)}, need $${amountUsd}`,
    );
  }

  const hash = await walletClient.writeContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "transfer",
    args: [to, amount],
  });

  try {
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
  } catch (err: any) {
    const m = String(err?.message ?? "");
    if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
      console.warn(`[crackpotUsdt] payWinner receipt timeout (${reason}) — proceeding`);
    } else {
      throw err;
    }
  }

  console.log(`[crackpotUsdt] paid $${amountUsd} from treasury → ${to} (${reason}) tx:${hash}`);
  return hash;
}
