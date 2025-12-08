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

const TRANSFER_IN_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!, $min: BigInt!) {
    transfers(
      first: 1
      where: {
        to: $user
        blockTimestamp_gt: $since
        value_gte: $min
      }
    ) {
      id
    }
  }
`;

/* ---------------------------------------------------------------- helpers */

async function hasRecentTopupAtLeast(
  user: string,
  token: string,
  url: string,
  minUsd: number,
  windowSeconds: number
): Promise<boolean> {
  const since = (Math.floor(Date.now() / 1_000) - windowSeconds).toString();
  const decimals = DECIMALS[token] ?? 18;

  const minWei = BigInt(Math.floor(minUsd)) * 10n ** BigInt(decimals);

  const { transfers } = await request<{ transfers: { id: string }[] }>(
    url,
    TRANSFER_IN_QUERY,
    {
      user: user.toLowerCase(),
      since,
      min: minWei.toString(),
    }
  );

  return transfers.length > 0;
}

/**
 * Has the wallet **received** ≥ $5 (cUSD or USDT) in the last 7 days?
 */
export async function userToppedUpAtLeast5DollarsInLast7Days(
  userAddress: string
): Promise<boolean> {
  const windowSeconds = 7 * 24 * 60 * 60;
  const minUsd = 5;

  const okCusd = await hasRecentTopupAtLeast(
    userAddress,
    CUSD_ADDRESS,
    URL_CUSD,
    minUsd,
    windowSeconds
  );

  if (okCusd) return true;

  const okUsdt = await hasRecentTopupAtLeast(
    userAddress,
    USDT_ADDRESS,
    URL_USDT,
    minUsd,
    windowSeconds
  );

  return okUsdt;
}
