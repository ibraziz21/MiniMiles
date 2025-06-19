export async function fetchTotalRewardsWon(user: string): Promise<{
    totalUSD: number;
    breakdown: { token: string; amount: number }[];
  }> {
    // Step 1: Fetch roundIds user won
    const winsQuery = `
      query GetWins($user: Bytes!) {
        winnerSelecteds(where: { winner: $user }) {
          roundId
        }
      }
    `;
    const winsRes = await fetch("https://api.studio.thegraph.com/query/106434/minimiles/version/latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: winsQuery, variables: { user: user.toLowerCase() } }),
    });
    const roundIds = winsRes.ok ? (await winsRes.json()).data?.winnerSelecteds.map((w: any) => w.roundId.toString()) : [];
  
    if (roundIds.length === 0) return { totalUSD: 0, breakdown: [] };
  
    // Step 2: Fetch roundCreateds by ID
    const roundsQuery = `
      query GetRoundRewards($ids: [ID!]!) {
        roundCreateds(where: { id_in: $ids }) {
          rewardPool
          rewardToken
        }
      }
    `;
    const roundsRes = await fetch("https://api.studio.thegraph.com/query/106434/minimiles/version/latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: roundsQuery, variables: { ids: roundIds } }),
    });
    const rounds = roundsRes.ok ? (await roundsRes.json()).data?.roundCreateds ?? [] : [];
  
    // Step 3: Sum reward amounts by token
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
  
    // USD Estimation (mocked here)
    const USD_RATES: Record<string, number> = {
      "0xaddress_of_cusd": 1,
      "0xaddress_of_usdt": 1,
    };
  
    const totalUSD = breakdown.reduce(
      (sum, item) => sum + (item.amount * (USD_RATES[item.token] || 0)),
      0
    );
  
    return { totalUSD, breakdown };
  }
  