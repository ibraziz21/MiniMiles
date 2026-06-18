import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { celo } from "viem/chains";

/* ----------------------------------------------------------------- config */

const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const USDC_ADDRESS = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

if (!CUSD_ADDRESS || !USDT_ADDRESS || !USDC_ADDRESS) {
  throw new Error("[graphQuestTransfer] Missing token addresses.");
}

/** decimals lookup */
const DECIMALS: Record<string, number> = {
  [CUSD_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
  [USDC_ADDRESS.toLowerCase()]: 6,
};

/* ----------------------------------------------------------------- RPC client */

const publicClient = createPublicClient({
  chain: celo,
  transport: http(RPC_URL),
});

const ERC20_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/**
 * ~24h on Celo. This is an approximation; good enough for quest gating.
 * Increase if you want to be safer.
 */
const DEFAULT_LOOKBACK_BLOCKS = 22_000n;
const RPC_LOG_CHUNK_BLOCKS = 4_000n;

type TransferDirection = "out" | "in";
type TransferLog = { args?: { value?: bigint } };

function isRangeTooWideError(err: unknown): boolean {
  const parts = [
    err instanceof Error ? err.message : String(err),
    typeof err === "object" && err && "details" in err
      ? String((err as { details?: unknown }).details)
      : "",
    typeof err === "object" && err && "shortMessage" in err
      ? String((err as { shortMessage?: unknown }).shortMessage)
      : "",
  ];

  return parts.join(" ").toLowerCase().includes("query exceeds range");
}

async function getTransferLogsForRange(params: {
  direction: TransferDirection;
  user: string;
  token: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<TransferLog[]> {
  try {
    const logs = await publicClient.getLogs({
      address: params.token as Address,
      event: ERC20_TRANSFER,
      args:
        params.direction === "out"
          ? { from: params.user as Address }
          : { to: params.user as Address },
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
    });

    return logs as TransferLog[];
  } catch (err) {
    if (!isRangeTooWideError(err) || params.fromBlock >= params.toBlock) {
      throw err;
    }

    const midBlock = (params.fromBlock + params.toBlock) / 2n;
    const first = await getTransferLogsForRange({
      ...params,
      toBlock: midBlock,
    });
    const second = await getTransferLogsForRange({
      ...params,
      fromBlock: midBlock + 1n,
    });

    return [...first, ...second];
  }
}

async function scanTransferLogs(
  params: {
    direction: TransferDirection;
    user: string;
    token: string;
    fromBlock: bigint;
    toBlock: bigint;
  },
  onLogs: (logs: TransferLog[]) => boolean | void,
  options: { newestFirst?: boolean } = {}
): Promise<void> {
  if (params.fromBlock > params.toBlock) return;

  if (options.newestFirst) {
    let toBlock = params.toBlock;
    while (toBlock >= params.fromBlock) {
      const chunkStart =
        toBlock - RPC_LOG_CHUNK_BLOCKS + 1n > params.fromBlock
          ? toBlock - RPC_LOG_CHUNK_BLOCKS + 1n
          : params.fromBlock;
      const logs = await getTransferLogsForRange({
        ...params,
        fromBlock: chunkStart,
        toBlock,
      });
      if (onLogs(logs)) return;
      if (chunkStart === params.fromBlock) return;
      toBlock = chunkStart - 1n;
    }
    return;
  }

  let fromBlock = params.fromBlock;
  while (fromBlock <= params.toBlock) {
    const chunkEnd =
      fromBlock + RPC_LOG_CHUNK_BLOCKS - 1n < params.toBlock
        ? fromBlock + RPC_LOG_CHUNK_BLOCKS - 1n
        : params.toBlock;
    const logs = await getTransferLogsForRange({
      ...params,
      fromBlock,
      toBlock: chunkEnd,
    });
    if (onLogs(logs)) return;
    if (chunkEnd === params.toBlock) return;
    fromBlock = chunkEnd + 1n;
  }
}

/* ------------------------------------------------------------- caching */

type CacheEntry = { expires: number; value: boolean };
const TTL_MS = 25_000;

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<boolean>>();

function cacheKey(direction: TransferDirection, user: string, token: string) {
  return `${direction}:${user.toLowerCase()}:${token.toLowerCase()}`;
}

function readCache(key: string): boolean | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: boolean) {
  CACHE.set(key, { value, expires: Date.now() + TTL_MS });
}

/* ---------------------------------------------------------------- helpers */

function oneDollarMin(token: string): bigint {
  const decimals = DECIMALS[token.toLowerCase()] ?? 18;
  return 10n ** BigInt(decimals);
}

async function hasRecentTransferViaRpc(params: {
  direction: TransferDirection;
  user: string;
  token: string;
  min: bigint;
  lookbackBlocks?: bigint;
}): Promise<boolean> {
  const lookback = params.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;

  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > lookback ? latest - lookback : 0n;

  let found = false;
  await scanTransferLogs(
    {
      direction: params.direction,
      user: params.user,
      token: params.token,
      fromBlock,
      toBlock: latest,
    },
    (logs) => {
      found = logs.some((l) => {
        const value = l.args?.value;
        return typeof value === "bigint" && value >= params.min;
      });
      return found;
    },
    { newestFirst: true }
  );

  return found;
}

async function countOutgoingViaRpc(
  user: string,
  token: string,
  min: bigint,
  lookbackBlocks = DEFAULT_LOOKBACK_BLOCKS
): Promise<number> {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;

  let count = 0;
  await scanTransferLogs(
    {
      direction: "out",
      user,
      token,
      fromBlock,
      toBlock: latest,
    },
    (logs) => {
      count += logs.filter((l) => {
        const value = l.args?.value;
        return typeof value === "bigint" && value >= min;
      }).length;
    }
  );

  return count;
}

/**
 * Cached RPC checker:
 * - TTL cache + in-flight de-dupe
 * - never throws (returns false on errors)
 */
async function hasRecentTransferCached(params: {
  direction: TransferDirection;
  user: string;
  token: string;
}): Promise<boolean> {
  const key = cacheKey(params.direction, params.user, params.token);

  const cached = readCache(key);
  if (cached !== null) return cached;

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    const min = oneDollarMin(params.token);

    try {
      const ok = await hasRecentTransferViaRpc({
        direction: params.direction,
        user: params.user,
        token: params.token,
        min,
      });
      writeCache(key, ok);
      return ok;
    } catch (err) {
      console.error("[graphQuestTransfer] RPC transfer scan failed:", err);
      writeCache(key, false);
      return false;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);
  return p;
}

/* ---------------------------------------------------------------- exports */

/**
 * Count how many outgoing transfers the wallet made across cUSD + USDT + USDC
 * in the last 24 h.
 */
export async function countOutgoingTransfersIn24H(
  userAddress: string
): Promise<number> {
  const user = userAddress.toLowerCase();

  const tokens = [CUSD_ADDRESS, USDT_ADDRESS, USDC_ADDRESS];

  let total = 0;

  for (const token of tokens) {
    const min = oneDollarMin(token);
    total += await countOutgoingViaRpc(user, token, min);
  }

  return total;
}

/**
 * Has the wallet **sent** ≥ $1 (cUSD, USDT, or USDC) in the last 24 h?
 */
export async function userSentAtLeast1DollarIn24Hrs(
  userAddress: string
): Promise<boolean> {
  const user = userAddress.toLowerCase();

  const cusd = await hasRecentTransferCached({
    direction: "out",
    user,
    token: CUSD_ADDRESS,
  });
  if (cusd) return true;

  const usdt = await hasRecentTransferCached({
    direction: "out",
    user,
    token: USDT_ADDRESS,
  });
  if (usdt) return true;

  return hasRecentTransferCached({
    direction: "out",
    user,
    token: USDC_ADDRESS,
  });
}

/**
 * Has the wallet **received** ≥ $1 (cUSD, USDT, or USDC) in the last 24 h?
 */
export async function userReceivedAtLeast1DollarIn24Hrs(
  userAddress: string
): Promise<boolean> {
  const user = userAddress.toLowerCase();

  const cusd = await hasRecentTransferCached({
    direction: "in",
    user,
    token: CUSD_ADDRESS,
  });
  if (cusd) return true;

  const usdt = await hasRecentTransferCached({
    direction: "in",
    user,
    token: USDT_ADDRESS,
  });
  if (usdt) return true;

  return hasRecentTransferCached({
    direction: "in",
    user,
    token: USDC_ADDRESS,
  });
}
