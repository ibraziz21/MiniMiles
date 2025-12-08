// src/helpers/graphGames.ts
import { gql, request } from "graphql-request";

/* ----------------------------------------------------------------- config */

const { GAMES_SUBGRAPH_URL = "" } = process.env;

if (!GAMES_SUBGRAPH_URL) {
  console.warn("[graphGames] GAMES_SUBGRAPH_URL not set");
}

/* ------------------------------------------------------------- GQL docs  */

const GAME_JOINS_QUERY = gql`
  query ($user: Bytes!, $since: BigInt!) {
    gameJoins(
      first: 1
      where: { player: $user, timestamp_gte: $since }
    ) {
      id
    }
  }
`;

/* ---------------------------------------------------------------- helpers */

/**
 * Check if user participated in at least 1 game in the last 24 hours.
 */
export async function userPlayedAtLeastOneGameInLast24Hrs(
  userAddress: string
): Promise<boolean> {
  if (!GAMES_SUBGRAPH_URL) return false;

  const since = (Math.floor(Date.now() / 1_000) - 24 * 60 * 60).toString();

  const { gameJoins } = await request<{ gameJoins: { id: string }[] }>(
    GAMES_SUBGRAPH_URL,
    GAME_JOINS_QUERY,
    {
      user: userAddress.toLowerCase(),
      since,
    }
  );

  return gameJoins.length > 0;
}
