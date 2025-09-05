// helpers/raffle.ts

import { StaticImageData } from "next/image"
import { Address } from "viem"



export type TokenRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  token: { address: Address; symbol: string; decimals: number }
  rewardPool: string        // formatted
  ticketCost: string        // formatted (18d)
  image?: string            // optional if you attach one later
  description?: string
}

export type PhysicalRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  prizeNFT?: Address
  ticketCost: string        // formatted (18d)
  rewardURI?: string        // if you later expose it
}

export async function fetchActiveRaffles(): Promise<{
  tokenRaffles: TokenRaffle[]
  physicalRaffles: PhysicalRaffle[]
}> {
  const res = await fetch('/api/Spend/raffle_display', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch raffles')
  return res.json()
}

  