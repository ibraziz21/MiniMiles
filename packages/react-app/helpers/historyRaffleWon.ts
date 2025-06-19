export async function fetchTotalRafflesWon(user: string): Promise<number> {
    const query = `
      query GetTotalRafflesWon($user: Bytes!) {
        winnerSelecteds(where: { winner: $user }) {
          id
        }
      }
    `;
  
    const res = await fetch("https://api.studio.thegraph.com/query/106434/minimiles/version/latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { user: user.toLowerCase() },
      }),
    });
  
    const json = await res.json();
    return json.data?.winnerSelecteds?.length || 0;
  }
  