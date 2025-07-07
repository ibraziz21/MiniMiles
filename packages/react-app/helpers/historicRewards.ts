export async function fetchTotalRewardsWon(user: string): Promise<{
    totalUSD: number;
    breakdown: { token: string; amount: number }[];
  }> {
    // Step 1: Fetch roundIds user won
    const winsQuery = `
      query GetWins($user: Bytes!) {
        winnerSelecteds(where: { winner: $user }) {
          roundId
          rewardPool
        }
      }
    `;
    const winsRes = await fetch("https://api.studio.thegraph.com/query/115307/akiba-miles/version/latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: winsQuery, variables: { user: user.toLowerCase() } }),
    });
    const roundIds = winsRes.ok ? (await winsRes.json()).data?.winnerSelecteds.map((w: any) => w.roundId.toString()) : [];
  
    if (roundIds.length === 0) return { totalUSD: 0, breakdown: [] };
  
    // Step 2: Fetch roundCreateds by ID
    const roundsQuery = `
      query GetRoundRewards {
        roundCreateds(where: { roundId: $ids }) {
          rewardPool
          rewardToken
        }
      }
    `;
    const roundsRes = await fetch("https://api.studio.thegraph.com/query/115307/akiba-miles/version/latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: roundsQuery, variables: { ids: roundIds } }),
      });
    
      const rounds = roundsRes.ok
        ? (await roundsRes.json()).data?.roundCreateds ?? []
        : [];
    
      // Step 3: Sum amounts by token
      const totals: Record<string, bigint> = {};
      for (const r of rounds) {
        const token = r.rewardToken.toLowerCase();
        const amount = BigInt(r.rewardPool);
        totals[token] = (totals[token] || 0n) + amount;
      }
    
      const breakdown = Object.entries(totals).map(([token, amt]) => ({
        token,
        amount: Number(amt) / 1e18,
      }));
    
      // Step 4: Total USD = sum of all reward amounts (since they're all USD stablecoins)
      const totalUSD = breakdown.reduce((sum, item) => sum + item.amount, 0);
    
      return { totalUSD, breakdown };
    }