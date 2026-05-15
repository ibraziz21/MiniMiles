// helpers/raffledisplay.ts

import { StaticImageData } from "next/image"
import { Address } from "viem"
import type { RaffleRequirementsResult } from "@/types/raffleRequirements"

export type { RaffleRequirementsResult }

/** Shape returned by /api/Spend/raffle_display for token raffles */
export type TokenRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  token: { address: Address; symbol: string; decimals: number }
  rewardPool: string          // formatted
  ticketCost: string          // formatted (18d)
  winnersSelected?: boolean
  // Supabase raffle_meta fields (null/absent when no row exists)
  winners?: number
  cardTitle?: string | null     // display title for the raffle card
  prizeTitle?: string | null    // prize label shown inside the sheet
  description?: string | null
  cardImageUrl?: string | null
  // Supabase raffle_requirements — gated config without per-user eligibility
  requirements?: Pick<RaffleRequirementsResult, 'roundId' | 'gated' | 'eligible' | 'mode' | 'gates'> | null
  // Legacy optional field kept for backward-compat
  image?: string | StaticImageData
}

/** Shape returned by /api/Spend/raffle_display for physical raffles */
export type PhysicalRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  prizeNFT?: Address
  ticketCost: string          // formatted (18d)
  winnersSelected?: boolean
  // Supabase raffle_meta fields
  winners?: number
  cardTitle?: string | null
  prizeTitle?: string | null
  description?: string | null
  cardImageUrl?: string | null
  requirements?: Pick<RaffleRequirementsResult, 'roundId' | 'gated' | 'eligible' | 'mode' | 'gates'> | null
  // Legacy optional field
  rewardURI?: string
}

export async function fetchActiveRaffles(): Promise<{
  tokenRaffles: TokenRaffle[]
  physicalRaffles: PhysicalRaffle[]
}> {
  const res = await fetch('/api/Spend/raffle_display', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch raffles')
  return res.json()
}
