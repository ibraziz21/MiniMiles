
import { gql, request } from 'graphql-request';

/* ----------------------------------------------------------------- config */

const URL_CUSD = "https://api.studio.thegraph.com/query/114722/transfers-18-d/version/latest";
const URL_USDT = "https://api.studio.thegraph.com/query/114722/transfers-6-d/version/latest";


const CUSD_ADDRESS="0x765de816845861e75a25fca122bb6898b8b1282a" 
const USDT_ADDRESS="0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"

if (!URL_CUSD || !URL_USDT || !CUSD_ADDRESS || !USDT_ADDRESS) {
  throw new Error(
    '[tokenTransfers] Missing SUBGRAPH_* or *_ADDRESS env vars. ' +
      'Check .env.local',
  );
}

/** decimals lookup */
const DECIMALS: Record<string, number> = {
  [CUSD_ADDRESS]: 18,
  [USDT_ADDRESS]: 6,
};

/* ------------------------------------------------------------- GQL docs  */

const TRANSFER_OUT_QUERY = gql`
  query ($user: Bytes!, $token: Bytes!, $since: BigInt!, $min: BigInt!) {
    transfers(
      first: 1
      where: {
        from:  $user
        blockTimestamp_gt: $since
        value_gte: $min
      }
    ) { id }
  }
`;

const TRANSFER_IN_QUERY = gql`
  query ($user: Bytes!, $token: Bytes!, $since: BigInt!, $min: BigInt!) {
    transfers(
      first: 1
      where: {
        to:    $user
        blockTimestamp_gt: $since
        value_gte: $min
      }
    ) { id }
  }
`;

/* ---------------------------------------------------------------- helpers */

async function hasRecentTransfer(
  direction: 'out' | 'in',
  user: string,
  token: string,
  url: string,
): Promise<boolean> {
  const since24h = (Math.floor(Date.now() / 1_000) - 86_400).toString();
  const decimals = DECIMALS[token] ?? 18;
  const oneDollarWei = (10n ** BigInt(decimals)).toString(); // 1 * 10^dec

  const { transfers } = await request<{
    transfers: { id: string }[];
  }>(
    url,
    direction === 'out' ? TRANSFER_OUT_QUERY : TRANSFER_IN_QUERY,
    {
      user: user.toLowerCase(),
      token,
      since: since24h,
      min: oneDollarWei,
    },
  );

  return transfers.length > 0;
}

/* ---------------------------------------------------------------- exports */

/**
 * Has the wallet **sent** ≥ $1 (cUSD or USDT) in the last 24 h?
 */
export async function userSentAtLeast1DollarIn24Hrs(
  userAddress: string,
): Promise<boolean> {
  return (
    (await hasRecentTransfer('out', userAddress, CUSD_ADDRESS, URL_CUSD)) ||
    (await hasRecentTransfer('out', userAddress, USDT_ADDRESS, URL_USDT))
  );
}

/**
 * Has the wallet **received** ≥ $1 (cUSD or USDT) in the last 24 h?
 */
export async function userReceivedAtLeast1DollarIn24Hrs(
  userAddress: string,
): Promise<boolean> {
  return (
    (await hasRecentTransfer('in', userAddress, CUSD_ADDRESS, URL_CUSD)) ||
    (await hasRecentTransfer('in', userAddress, USDT_ADDRESS, URL_USDT))
  );
}


