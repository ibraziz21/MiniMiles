// lib/server/crackpotContract.ts
// Thin viem wrapper for the CrackPot contract — relayer-only calls.
// Supports both Celo (MILES/USDT versions) and Base (MILES/STABLE versions).

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { celo, base } from "viem/chains";

// ── Chain params ──────────────────────────────────────────────────────────────

const CELO_CRACKPOT  = (process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS      ?? "") as `0x${string}`;
const BASE_CRACKPOT  = (process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS  ?? "") as `0x${string}`;
const CELO_RPC       = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const BASE_RPC       = process.env.BASE_RPC_URL  ?? "https://mainnet.base.org";
const RELAYER_PK     = (process.env.PRIVATE_KEY ?? "").replace(/^0x/, "");

function chainParams(chainId: number = celo.id) {
  if (chainId === base.id) {
    return { chain: base, rpc: BASE_RPC, address: BASE_CRACKPOT };
  }
  return { chain: celo, rpc: CELO_RPC, address: CELO_CRACKPOT };
}

// ── Version enum mirrors both contracts: 0 = MILES, 1 = USDT/STABLE ─────────

export const ContractVersion = { MILES: 0, USDT: 1, STABLE: 1 } as const;
export type ContractVersionType = 0 | 1;

// ── ABI ───────────────────────────────────────────────────────────────────────
// Reflects the upgraded CrackPot with:
//   • openCycle(uint8, uint64, bytes32)   — commitment-aware (required)
//   • openCycle(uint8, uint64)            — deprecated, reverts CommitmentRequired
//   • CycleOpened event includes bytes32 secretCommitment
//   • CycleCracked event for settlement finalization

const ABI = parseAbi([
  "error CycleAlreadyActive(uint8 version)",
  "error CycleNotActive(uint256 cycleId)",
  "error CycleNotExpired(uint256 cycleId)",
  "error InsufficientMilesBalance()",
  "error InvalidVersion()",
  "error NoCycleActive(uint8 version)",
  "error NotRelayer()",
  "error ZeroAddress()",
  "error WithdrawExceedsHouseBalance(uint256 requested, uint256 available)",
  "error USDTRescueBlocked()",
  "error USDTRecordEntryBlocked()",
  "error CommitmentRequired()",
  // Commitment-aware open (required path).
  "function openCycle(uint8 version, uint64 expiresAt, bytes32 secretCommitment) external",
  "function recordEntry(uint8 version, address player) external",
  "function declareWinner(uint8 version, address winner, uint256 guesses) external",
  "function expireCycle(uint8 version) external",
  "function withdrawHouse(uint256 amount) external",
  "function getActiveCycle(uint8 version) external view returns ((uint256 id,uint8 version,uint8 status,uint256 potBalance,uint256 potCap,uint256 seedAmount,uint256 houseAccrued,uint64 openedAt,uint64 expiresAt,address winner,uint256 winnerGuesses,bytes32 secretCommitment))",
  "function potBalance(uint8 version) external view returns (uint256)",
  "function activeCycleId(uint8 version) external view returns (uint256)",
  "function usdtAccounting() external view returns (uint256 balance, uint256 reservedPot, uint256 houseWithdrawable, uint256 freeBalance)",
  // Events
  "event CycleOpened(uint256 indexed cycleId, uint8 version, uint256 potSeed, uint64 expiresAt, bytes32 secretCommitment)",
  "event CycleCracked(uint256 indexed cycleId, address indexed winner, uint256 payout, uint256 guesses)",
  "event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance)",
]);

export const CYCLE_CRACKED_ABI = parseAbi([
  "event CycleCracked(uint256 indexed cycleId, address indexed winner, uint256 payout, uint256 guesses)",
]);

export type ContractCycle = {
  id: bigint;
  version: number;
  status: number;
  potBalance: bigint;
  potCap: bigint;
  seedAmount: bigint;
  houseAccrued: bigint;
  openedAt: bigint;
  expiresAt: bigint;
  winner: `0x${string}`;
  winnerGuesses: bigint;
  secretCommitment: `0x${string}`;
};

export type CycleCrackedEvent = {
  cycleId: bigint;
  winner: `0x${string}`;
  payout: bigint;
  guesses: bigint;
};

const ERROR_SELECTOR = {
  CycleAlreadyActive: "0x6a55f32a",
  CycleNotExpired:    "0xf3982569",
  NoCycleActive:      "0x21a4dad2",
} as const;

// ── Clients ───────────────────────────────────────────────────────────────────

function getPublicClient(chainId?: number) {
  const { chain, rpc, address } = chainParams(chainId);
  if (!address) throw new Error(`CrackPot address not configured for chain ${chainId ?? celo.id}`);
  return createPublicClient({ chain, transport: http(rpc) });
}

function getClients(chainId?: number) {
  if (!RELAYER_PK || RELAYER_PK.length < 10) throw new Error("PRIVATE_KEY not configured");
  const { chain, rpc, address } = chainParams(chainId);
  if (!address) throw new Error(`CrackPot address not configured for chain ${chainId ?? celo.id}`);
  const account      = privateKeyToAccount(`0x${RELAYER_PK}` as `0x${string}`, { nonceManager });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });
  return { account, publicClient, walletClient, address };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function getErrorSelector(err: any): string | null {
  const candidates = [
    err?.signature, err?.cause?.signature, err?.cause?.cause?.signature,
    err?.data, err?.cause?.data, err?.cause?.cause?.data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^0x[0-9a-fA-F]{8}/.test(c)) return c.slice(0, 10).toLowerCase();
  }
  return null;
}

function isKnownCycleRace(err: any, pattern: RegExp, selectors: readonly string[] = []): boolean {
  const message = [err?.shortMessage, err?.message, err?.cause?.shortMessage, err?.cause?.message]
    .filter(Boolean).join("\n");
  const selector = getErrorSelector(err);
  return pattern.test(message) || (selector !== null && selectors.includes(selector));
}

function isNonceOrGasRace(err: any): boolean {
  const m = [err?.shortMessage, err?.message, err?.cause?.shortMessage, err?.cause?.message]
    .filter(Boolean).join("\n").toLowerCase();
  return (
    m.includes("nonce has already been used") ||
    m.includes("nonce too low") ||
    m.includes("lower than the current nonce") ||
    m.includes("current nonce") ||
    m.includes("replacement transaction underpriced") ||
    m.includes("already known") ||
    m.includes("transaction with the same hash was already imported")
  );
}

async function sendTx(chainId: number | undefined, fn: () => Promise<`0x${string}`>): Promise<`0x${string}`> {
  const { publicClient } = getClients(chainId);

  let lastErr: any = null;
  let hash: `0x${string}` | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      hash = await fn();
      break;
    } catch (err: any) {
      lastErr = err;
      if (!isNonceOrGasRace(err)) throw err;
      console.warn("[crackpotContract] nonce/gas race, retrying…", attempt + 1);
    }
  }
  if (!hash) throw lastErr ?? new Error("crackpot tx failed after nonce retries");

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

// ── Exported API ──────────────────────────────────────────────────────────────

export async function contractRecordEntry(
  version: ContractVersionType,
  player: `0x${string}`,
  chainId?: number,
): Promise<`0x${string}`> {
  const { walletClient, address } = getClients(chainId);
  return sendTx(chainId, () =>
    walletClient.writeContract({ address, abi: ABI, functionName: "recordEntry", args: [version, player] }),
  );
}

/**
 * Calls declareWinner and returns the full transaction receipt so the caller
 * can decode and verify the CycleCracked event.
 */
export async function contractDeclareWinner(
  version: ContractVersionType,
  winner: `0x${string}`,
  guesses: number,
  chainId?: number,
): Promise<{ txHash: `0x${string}`; cycleCracked: CycleCrackedEvent }> {
  const { walletClient, address, publicClient } = getClients(chainId);
  const { address: contractAddr } = chainParams(chainId);

  const txHash = await sendTx(chainId, () =>
    walletClient.writeContract({
      address,
      abi: ABI,
      functionName: "declareWinner",
      args: [version, winner, BigInt(guesses)],
    }),
  );

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

  // Decode the CycleCracked event from the receipt.
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddr.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi:    CYCLE_CRACKED_ABI,
        data:   log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "CycleCracked") continue;
      const { cycleId, winner: crackedWinner, payout, guesses: crackedGuesses } = decoded.args as {
        cycleId: bigint;
        winner: `0x${string}`;
        payout: bigint;
        guesses: bigint;
      };
      return {
        txHash,
        cycleCracked: { cycleId, winner: crackedWinner, payout, guesses: crackedGuesses },
      };
    } catch {
      continue;
    }
  }

  throw new Error(`[crackpotContract] CycleCracked event not found in receipt ${txHash}`);
}

/**
 * Open a new cycle with a fairness commitment (required from V2 onwards).
 * The old two-arg openCycle is deprecated and will revert on-chain.
 */
export async function contractOpenCycle(
  version: ContractVersionType,
  expiresAt: Date,
  secretCommitment: Hex,
  chainId?: number,
): Promise<`0x${string}`> {
  const { walletClient, address } = getClients(chainId);
  const expiresAtUnix = BigInt(Math.floor(expiresAt.getTime() / 1000));
  return sendTx(chainId, () =>
    walletClient.writeContract({
      address,
      abi: ABI,
      functionName: "openCycle",
      args: [version, expiresAtUnix, secretCommitment],
    }),
  );
}

export async function contractGetActiveCycle(
  version: ContractVersionType,
  chainId?: number,
): Promise<ContractCycle | null> {
  const publicClient = getPublicClient(chainId);
  const { address } = chainParams(chainId);
  try {
    const cycle = await publicClient.readContract({ address, abi: ABI, functionName: "getActiveCycle", args: [version] });
    return cycle as ContractCycle;
  } catch (err: any) {
    if (isKnownCycleRace(err, /no active cycle|NoCycleActive/i, [ERROR_SELECTOR.NoCycleActive])) return null;
    throw err;
  }
}

export async function contractExpireCycle(
  version: ContractVersionType,
  chainId?: number,
): Promise<`0x${string}`> {
  const { walletClient, address } = getClients(chainId);
  return sendTx(chainId, () =>
    walletClient.writeContract({ address, abi: ABI, functionName: "expireCycle", args: [version] }),
  );
}

export async function contractPotBalance(
  version: ContractVersionType,
  chainId?: number,
): Promise<bigint> {
  const publicClient = getPublicClient(chainId);
  const { address } = chainParams(chainId);
  return publicClient.readContract({ address, abi: ABI, functionName: "potBalance", args: [version] }) as Promise<bigint>;
}

export async function contractActiveCycleId(
  version: ContractVersionType,
  chainId?: number,
): Promise<bigint> {
  const publicClient = getPublicClient(chainId);
  const { address } = chainParams(chainId);
  return publicClient.readContract({ address, abi: ABI, functionName: "activeCycleId", args: [version] }) as Promise<bigint>;
}

export type UsdtAccounting = {
  balance: bigint;
  reservedPot: bigint;
  houseWithdrawable: bigint;
  freeBalance: bigint;
};

export async function contractUsdtAccounting(chainId?: number): Promise<UsdtAccounting> {
  const publicClient = getPublicClient(chainId);
  const { address } = chainParams(chainId);
  const result = await publicClient.readContract({ address, abi: ABI, functionName: "usdtAccounting" }) as readonly [bigint, bigint, bigint, bigint];
  return {
    balance:           result[0],
    reservedPot:       result[1],
    houseWithdrawable: result[2],
    freeBalance:       result[3],
  };
}
