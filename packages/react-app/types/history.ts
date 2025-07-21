export type HistoryItem =
  | { id: string; ts: number; type: 'EARN'; amount: string; note: string }
  | { id: string; ts: number; type: 'SPEND'; amount: string; note: string }
  | { id: string; ts: number; type: 'RAFFLE_ENTRY'; roundId: string; note: string }
  | { id: string; ts: number; type: 'RAFFLE_WIN'; roundId: string; note: string }
  | {  id: string; type: 'RAFFLE_RESULT'; roundId: string; winner: string; note: string; ts: number };

export interface HistoryBundle {
  history: HistoryItem[];
  stats: {
    totalEarned: number;
    totalRafflesWon: number;
    totalUSDWon: number;
    // totalChallenges? -> currently separate
  };
  participatingRaffles: number[];
  meta: {
    address: string;
    cached: boolean; // (currently always false; can set when using cache retrieval)
    generatedAt: string;
    ttlMs: number;
  };
}
export type RaffleResultItem = {
  id: string;
  ts: number;
  roundId: string;
  winner: string;
  rewardToken: string;
  symbol: string;
  rewardPool: string | null;
  image: string | null;
  note: string;
};
