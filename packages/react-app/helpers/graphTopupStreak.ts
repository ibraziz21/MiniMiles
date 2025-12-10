// src/helpers/graphTopupStreak.ts
import { gql, request } from "graphql-request";

/* ----------------------------------------------------------------- config */

const URL_CUSD =
  "https://api.studio.thegraph.com/query/114722/transfers-18-d/version/latest";
const URL_USDT =
  "https://api.studio.thegraph.com/query/114722/transfers-6-d/version/latest";

const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

if (!URL_CUSD || !URL_USDT || !CUSD_ADDRESS || !USDT_ADDRESS) {
  throw new Error(
    "[graphTopupStreak] Missing subgraph URLs or token addresses, check config"
  );
}

/** decimals lookup */
const DECIMALS: Record<string, number> = {
  [CUSD_ADDRESS]: 18,
  [USDT_ADDRESS]: 6,
};

/* ------------------------------------------------------------- GQL docs  */

const TRANSFERS_WINDOW_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!) {
    transfers(
      first: 1000
      where: { to: $user, blockTimestamp_gt: $since }
      orderBy: blockTimestamp
      orderDirection: desc
    ) {
      value
    }
  }
`;

/* ---------------------------------------------------------------- helpers */

/**
 * Sum all incoming transfers for a user in the window and return
 * the total amount in "USD units" (cUSD/USDT both counted as 1:1 with USD).
 */
async function cumulativeTopupForToken(
  user: string,
  token: string,
  url: string,
  windowSeconds: number
): Promise<number> {
  const since = (Math.floor(Date.now() / 1_000) - windowSeconds).toString();
  const decimals = DECIMALS[token] ?? 18;

  const { transfers } = await request<{ transfers: { value: string }[] }>(
    url,
    TRANSFERS_WINDOW_QUERY,
    {
      user: user.toLowerCase(),
      since,
    }
  );

  if (!transfers || transfers.length === 0) return 0;

  const totalWei = transfers.reduce<bigint>((acc, t) => {
    try {
      return acc + BigInt(t.value);
    } catch {
      return acc;
    }
  }, 0n);

  const factor = 10 ** decimals;
  // convert to a JS number in token units (treated as 1 USD per token)
  return Number(totalWei) / factor;
}

/**
 * Get progress for "topped up at least minUsd in the last 7 days".
 * Treats cUSD + USDT as 1:1 with USD.
 */
export async function topupProgressLast7Days(
  userAddress: string,
  minUsd = 5
): Promise<{
  totalUsd: number;
  meets: boolean;
  shortfallUsd: number;
  targetUsd: number;
}> {
  const windowSeconds = 7 * 24 * 60 * 60;

  const cusd = await cumulativeTopupForToken(
    userAddress,
    CUSD_ADDRESS,
    URL_CUSD,
    windowSeconds
  );

  const usdt = await cumulativeTopupForToken(
    userAddress,
    USDT_ADDRESS,
    URL_USDT,
    windowSeconds
  );

  const totalUsd = cusd + usdt;
  const meets = totalUsd >= minUsd;
  const shortfallUsd = meets ? 0 : Math.max(0, minUsd - totalUsd);

  return {
    totalUsd,
    meets,
    shortfallUsd,
    targetUsd: minUsd,
  };
}

/**
 * Backwards-compatible boolean helper, if you still need it anywhere else.
 */
export async function userToppedUpAtLeast5DollarsInLast7Days(
  userAddress: string
): Promise<boolean> {
  const { meets } = await topupProgressLast7Days(userAddress, 5);
  return meets;
}
