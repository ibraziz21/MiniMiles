// lib/server/crackpotContract.ts
// Thin viem wrapper for the CrackPot contract — relayer-only calls.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { celo } from "viem/chains";

const CRACKPOT_ADDRESS = (
  process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? ""
) as `0x${string}`;

const CELO_RPC    = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RELAYER_PK  = (process.env.PRIVATE_KEY ?? "").replace(/^0x/, "");

// Version enum mirrors contract: 0 = MILES, 1 = USDT
export const ContractVersion = { MILES: 0, USDT: 1 } as const;
export type ContractVersionType = (typeof ContractVersion)[keyof typeof ContractVersion];

const ABI = parseAbi([
  "function openCycle(uint8 version, uint64 expiresAt) external",
  "function recordEntry(uint8 version, address player) external",
  "function declareWinner(uint8 version, address winner, uint256 guesses) external",
  "function expireCycle(uint8 version) external",
  "function withdrawHouse(uint256 amount) external",
  "function potBalance(uint8 version) external view returns (uint256)",
  "function activeCycleId(uint8 version) external view returns (uint256)",
]);

function getClients() {
  if (!RELAYER_PK || RELAYER_PK.length < 10) throw new Error("PRIVATE_KEY not configured");
  if (!CRACKPOT_ADDRESS) throw new Error("NEXT_PUBLIC_CRACKPOT_ADDRESS not configured");
  const account = privateKeyToAccount(`0x${RELAYER_PK}` as `0x${string}`, { nonceManager });
  const publicClient  = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const walletClient  = createWalletClient({ account, chain: celo, transport: http(CELO_RPC) });
  return { account, publicClient, walletClient };
}

async function sendTx(fn: () => Promise<`0x${string}`>): Promise<`0x${string}`> {
  const { publicClient } = getClients();
  const hash = await fn();
  try {
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
  } catch (err: any) {
    const m = String(err?.message ?? "");
    if (/(block.*out of range|header not found|query timeout)/i.test(m)) {
      console.warn("[crackpotContract] receipt timeout — proceeding:", hash);
    } else {
      throw err;
    }
  }
  return hash;
}

export async function contractRecordEntry(
  version: ContractVersionType,
  player: `0x${string}`,
): Promise<`0x${string}`> {
  const { walletClient } = getClients();
  return sendTx(() =>
    walletClient.writeContract({
      address: CRACKPOT_ADDRESS,
      abi: ABI,
      functionName: "recordEntry",
      args: [version, player],
    }),
  );
}

export async function contractDeclareWinner(
  version: ContractVersionType,
  winner: `0x${string}`,
  guesses: number,
): Promise<`0x${string}`> {
  const { walletClient } = getClients();
  return sendTx(() =>
    walletClient.writeContract({
      address: CRACKPOT_ADDRESS,
      abi: ABI,
      functionName: "declareWinner",
      args: [version, winner, BigInt(guesses)],
    }),
  );
}

export async function contractOpenCycle(
  version: ContractVersionType,
  expiresAt: Date,
): Promise<`0x${string}`> {
  const { walletClient } = getClients();
  const expiresAtUnix = BigInt(Math.floor(expiresAt.getTime() / 1000));
  return sendTx(() =>
    walletClient.writeContract({
      address: CRACKPOT_ADDRESS,
      abi: ABI,
      functionName: "openCycle",
      args: [version, expiresAtUnix],
    }),
  );
}

export async function contractExpireCycle(
  version: ContractVersionType,
): Promise<`0x${string}`> {
  const { walletClient } = getClients();
  return sendTx(() =>
    walletClient.writeContract({
      address: CRACKPOT_ADDRESS,
      abi: ABI,
      functionName: "expireCycle",
      args: [version],
    }),
  );
}

export async function contractPotBalance(
  version: ContractVersionType,
): Promise<bigint> {
  const { publicClient } = getClients();
  return publicClient.readContract({
    address: CRACKPOT_ADDRESS,
    abi: ABI,
    functionName: "potBalance",
    args: [version],
  }) as Promise<bigint>;
}
