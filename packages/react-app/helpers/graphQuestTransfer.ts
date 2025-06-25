import { request,gql } from 'graphql-request';

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/106434/daily-quests/v0.0.2' ;      // one endpoint
const CUSD_ADDRESS = process.env.CUSD_ADDRESS || ""
const USDT_ADDRESS = process.env.USDT_ADDRESS || ""
const DECIMALS = {
  [CUSD_ADDRESS.toLowerCase()]: 18,
  [USDT_ADDRESS.toLowerCase()]: 6,
} as const;

const TRANSFER_QUERY = gql`
query ($user: Bytes!, $token: Bytes!, $fromTs: BigInt!, $threshold: BigInt!) {
  transfers(
    first: 1
    where: {
      from:           $user
      token:          $token
      blockTimestamp_gt: $fromTs
      value_gte:      $threshold
    }
  ) { id }
}
`;

async function spentSinceYesterday(
  user: string,
  token: string,
): Promise<boolean> {
  const decimals = DECIMALS[token.toLowerCase() as keyof typeof DECIMALS] ?? 18;
  const threshold = (10n ** BigInt(decimals)).toString();   // $1
  const yesterday = (Math.floor(Date.now() / 1000) - 86400).toString();

  const { transfers } = await request<{
    transfers: { id: string }[];
  }>(SUBGRAPH_URL, TRANSFER_QUERY, {
    user:    user.toLowerCase(),
    token:   token.toLowerCase(),
    fromTs:  yesterday,
    threshold,
  });

  return transfers.length > 0;
}

export async function hasUserSpentAtLeast1DollarIn24Hrs(user: string) {
  return (
    (await spentSinceYesterday(user, CUSD_ADDRESS)) ||
    (await spentSinceYesterday(user, USDT_ADDRESS))
  );
}
