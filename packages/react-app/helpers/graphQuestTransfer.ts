import { gql, request, ClientError } from "graphql-request";
import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { celo } from "viem/chains";

/* ----------------------------------------------------------------- config */

const URL_CUSD =
  "https://api.studio.thegraph.com/query/114722/transfers-18-d/version/latest";
const URL_USDT =
  "https://api.studio.thegraph.com/query/1717663/usd-transfers/version/latest/";

const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

if (!URL_CUSD || !URL_USDT || !CUSD_ADDRESS || !USDT_ADDRESS) {
  throw new Error(
    "[graphQuestTransfer] Missing subgraph URLs or token addresses."
  );
}

/** decimals lookup */
const DECIMALS: Record<string, number> = {
  [CUSD_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
};

/* ----------------------------------------------------------------- RPC fallback */

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const ERC20_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/**
 * ~24h on Celo. This is an approximation; good enough for quest gating.
 * Increase if you want to be safer.
 */
const DEFAULT_LOOKBACK_BLOCKS = 22_000n;

/* ------------------------------------------------------------- caching */

type CacheEntry = { expires: number; value: boolean };
const TTL_MS = 25_000;

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<string, Promise<boolean>>();

function cacheKey(direction: "out" | "in", user: string, token: string) {
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

/* ------------------------------------------------------------- GQL docs  */
/**
 * Note: token is NOT used in the query because you are using
 * separate subgraphs per token (transfers-18-d vs transfers-6-d).
 * If your subgraph supports a token field, we can add it later.
 */

const TRANSFER_COUNT_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!, $min: BigInt!, $limit: Int!) {
    transfers(
      first: $limit
      where: { from: $user, blockTimestamp_gt: $since, value_gte: $min }
    ) {
      id
    }
    _meta {
      block { timestamp }
    }
  }
`;

const TRANSFER_OUT_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!, $min: BigInt!) {
    transfers(
      first: 1
      where: { from: $user, blockTimestamp_gt: $since, value_gte: $min }
    ) {
      id
    }
    _meta {
      block { timestamp }
    }
  }
`;

const TRANSFER_IN_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!, $min: BigInt!) {
    transfers(
      first: 1
      where: { to: $user, blockTimestamp_gt: $since, value_gte: $min }
    ) {
      id
    }
    _meta {
      block { timestamp }
    }
  }
`;

/** If the subgraph's latest indexed block is older than this, treat it as stale */
const SUBGRAPH_STALE_SECS = 2 * 3600; // 2 hours

/* ---------------------------------------------------------------- helpers */

function is429(err: unknown): boolean {
  return err instanceof ClientError && err.response?.status === 429;
}

function oneDollarMin(token: string): bigint {
  const decimals = DECIMALS[token.toLowerCase()] ?? 18;
  return 10n ** BigInt(decimals);
}

async function hasRecentTransferViaSubgraph(params: {
  direction: "out" | "in";
  user: string;
  url: string;
  min: bigint;
}): Promise<{ hasTransfer: boolean; subgraphTs: number }> {
  const since24h = Math.floor(Date.now() / 1000) - 86_400;

  const result = await request<{
    transfers: { id: string }[];
    _meta: { block: { timestamp: number } };
  }>(
    params.url,
    params.direction === "out" ? TRANSFER_OUT_QUERY : TRANSFER_IN_QUERY,
    {
      user: params.user.toLowerCase(),
      since: since24h.toString(),
      min: params.min.toString(),
    }
  );

  return {
    hasTransfer: (result.transfers?.length ?? 0) > 0,
    subgraphTs: result._meta?.block?.timestamp ?? 0,
  };
}

async function hasRecentTransferViaRpc(params: {
  direction: "out" | "in";
  user: string;
  token: string;
  min: bigint;
  lookbackBlocks?: bigint;
}): Promise<boolean> {
  const lookback = params.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;

  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > lookback ? latest - lookback : 0n;

  const logs = await publicClient.getLogs({
    address: params.token as Address,
    event: ERC20_TRANSFER,
    args:
      params.direction === "out"
        ? { from: params.user as Address }
        : { to: params.user as Address },
    fromBlock,
    toBlock: "latest",
  });

  for (const l of logs) {
    const value = (l.args as any)?.value as bigint | undefined;
    if (typeof value === "bigint" && value >= params.min) return true;
  }
  return false;
}

async function countOutgoingViaRpc(
  user: string,
  token: string,
  min: bigint,
  lookbackBlocks = DEFAULT_LOOKBACK_BLOCKS
): Promise<number> {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;
  const logs = await publicClient.getLogs({
    address: token as Address,
    event: ERC20_TRANSFER,
    args: { from: user as Address },
    fromBlock,
    toBlock: "latest",
  });
  return logs.filter((l) => {
    const value = (l.args as any)?.value as bigint | undefined;
    return typeof value === "bigint" && value >= min;
  }).length;
}

/**
 * Smart checker:
 * - TTL cache + in-flight de-dupe
 * - subgraph primary
 * - if 429 => RPC fallback
 * - never throws (returns false on errors)
 */
async function hasRecentTransferSmart(params: {
  direction: "out" | "in";
  user: string;
  token: string;
  url: string;
}): Promise<boolean> {
  const key = cacheKey(params.direction, params.user, params.token);

  const cached = readCache(key);
  if (cached !== null) return cached;

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    const min = oneDollarMin(params.token);
    const now = Math.floor(Date.now() / 1000);

    const useRpcFallback = async (reason: string): Promise<boolean> => {
      console.warn(`[graphQuestTransfer] ${reason} — falling back to RPC`);
      try {
        const ok = await hasRecentTransferViaRpc({
          direction: params.direction,
          user: params.user,
          token: params.token,
          min,
        });
        writeCache(key, ok);
        return ok;
      } catch (rpcErr) {
        console.error("[graphQuestTransfer] RPC fallback failed:", rpcErr);
        writeCache(key, false);
        return false;
      }
    };

    try {
      const { hasTransfer, subgraphTs } = await hasRecentTransferViaSubgraph({
        direction: params.direction,
        user: params.user,
        url: params.url,
        min,
      });

      if (now - subgraphTs > SUBGRAPH_STALE_SECS) {
        return useRpcFallback(
          `Subgraph is ${((now - subgraphTs) / 3600).toFixed(1)}h behind`
        );
      }

      writeCache(key, hasTransfer);
      return hasTransfer;
    } catch (err) {
      return useRpcFallback(
        is429(err) ? "Rate limited (429)" : `Subgraph error: ${err}`
      );
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);
  return p;
}

/* ---------------------------------------------------------------- exports */

/**
 * Count how many outgoing transfers the wallet made across cUSD + USDT in the
 * last 24 h.  Uses the subgraph when fresh; falls back to RPC getLogs when
 * the subgraph is stale (> 2 h behind).
 */
export async function countOutgoingTransfersIn24H(
  userAddress: string
): Promise<number> {
  const user = userAddress.toLowerCase();
  const since = (Math.floor(Date.now() / 1_000) - 86_400).toString();
  const now = Math.floor(Date.now() / 1_000);
  const LIMIT = 1000;

  const tokens = [
    { url: URL_CUSD, token: CUSD_ADDRESS },
    { url: URL_USDT, token: USDT_ADDRESS },
  ];

  let total = 0;

  for (const { url, token } of tokens) {
    const min = oneDollarMin(token);
    try {
      const result = await request<{
        transfers: { id: string }[];
        _meta: { block: { timestamp: number } };
      }>(url, TRANSFER_COUNT_QUERY, { user, since, min: min.toString(), limit: LIMIT });

      const subgraphTs = result._meta?.block?.timestamp ?? 0;

      if (now - subgraphTs > SUBGRAPH_STALE_SECS) {
        console.warn(
          `[graphQuestTransfer] Count subgraph stale (${((now - subgraphTs) / 3600).toFixed(1)}h behind), using RPC for ${token}`
        );
        total += await countOutgoingViaRpc(user, token, min);
      } else {
        total += result.transfers?.length ?? 0;
      }
    } catch (err) {
      console.warn(`[graphQuestTransfer] Count subgraph error, using RPC: ${err}`);
      total += await countOutgoingViaRpc(user, token, min);
    }
  }

  return total;
}



/**
 * Has the wallet **sent** ≥ $1 (cUSD or USDT) in the last 24 h?
 */
export async function userSentAtLeast1DollarIn24Hrs(
  userAddress: string
): Promise<boolean> {
  const user = userAddress.toLowerCase();

  // cUSD first (now safe due to 429 fallback); swap order if you prefer.
  const cusd = await hasRecentTransferSmart({
    direction: "out",
    user,
    token: CUSD_ADDRESS,
    url: URL_CUSD,
  });
  if (cusd) return true;

  const usdt = await hasRecentTransferSmart({
    direction: "out",
    user,
    token: USDT_ADDRESS,
    url: URL_USDT,
  });
  return usdt;
}

/**
 * Has the wallet **received** ≥ $1 (cUSD or USDT) in the last 24 h?
 */
export async function userReceivedAtLeast1DollarIn24Hrs(
  userAddress: string
): Promise<boolean> {
  const user = userAddress.toLowerCase();

  const cusd = await hasRecentTransferSmart({
    direction: "in",
    user,
    token: CUSD_ADDRESS,
    url: URL_CUSD,
  });
  if (cusd) return true;

  const usdt = await hasRecentTransferSmart({
    direction: "in",
    user,
    token: USDT_ADDRESS,
    url: URL_USDT,
  });
  return usdt;
}
