// helpers/raffle.ts

import { StaticImageData } from "next/image"

export interface Raffle {
  symbol: any;
  id: string;
  starts: number;
  ends: number; // changed from string
  maxTickets: number;
  image: StaticImageData;
  totalTickets?: number;
  rewardToken: string;
  rewardPool?: string;
  ticketCost: number; // changed from string
  winnersSelected?: boolean;
  ticketsSold: number;
  description: string;
  status: string;
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
  