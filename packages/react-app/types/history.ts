export type HistoryItem =
  | { id: string; ts: number; type: 'EARN'; amount: string; note: string }
  | { id: string; ts: number; type: 'SPEND'; amount: string; note: string }
  | { id: string; ts: number; type: 'RAFFLE_ENTRY'; roundId: string; note: string }
  | { id: string; ts: number; type: 'RAFFLE_WIN'; roundId: string; note: string };

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