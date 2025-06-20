export async function fetchTotalMiniMilesEarned(user: string): Promise<number> {
    const query = `
      query GetTotalMiniMilesEarned($user: Bytes!) {
        transfers(where: { from: "0x0000000000000000000000000000000000000000", to: $user }) {
          value
        }
      }
    `;
  
    const res = await fetch("https://api.studio.thegraph.com/query/106434/minimiles/version/latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { user: user.toLowerCase() }
      }),
    });
  
    const json = await res.json();
    const values = json.data?.transfers?.map((t: any) => BigInt(t.value)) ?? [];
    const total = values.reduce((acc: bigint, val: bigint) => acc + val, 0n);
  
    return Number(total) / 1e18;
  }
  