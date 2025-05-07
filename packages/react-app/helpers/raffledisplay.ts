// helpers/raffle.ts

export interface Raffle {
    id: string               // roundId as string
    starts: number           // UNIX timestamp (seconds)
    ends: number             // UNIX timestamp (seconds)
    maxTickets: number
    totalTickets: number
    rewardToken: string      // ERC20 address
    rewardPool: string       // BigInt as decimal string
    ticketCost: number
    winnersSelected: boolean
  }
  
  export async function fetchActiveRaffles(): Promise<Raffle[]> {
    const res = await fetch('/api/Spend/raffle_display', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
  
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Failed to load raffles: ${err}`)
    }
  
    const json = (await res.json()) as { raffles: Raffle[] }
    return json.raffles
  }
  