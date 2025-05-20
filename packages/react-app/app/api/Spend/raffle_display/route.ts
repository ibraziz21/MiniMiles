// src/app/api/spend/raffle_display/route.ts
import { NextResponse } from 'next/server'
import { createPublicClient, formatUnits, http, parseUnits, type Abi } from 'viem'
import { celoAlfajores } from 'viem/chains'
import raffleAbi from '@/contexts/raffle.json' 
import    erc20Abi from '@/contexts/cusd-abi.json'      // must include getActiveRound
import type { Address } from 'viem'

const RAFFLE: Address = '0x9950De7445F89e733CddECBA11fBd40cFF6fD260'

const publicClient = createPublicClient({
  chain: celoAlfajores,
  transport: http(),
})

export async function GET() {
  try {
    // 1️⃣ Read total rounds
    const roundCountBN = await publicClient.readContract({
      address: RAFFLE,
      abi: raffleAbi.abi as Abi,
      functionName: 'roundIdCounter',
    })
    const total = Number(roundCountBN)
    if (total === 0) {
      return NextResponse.json({ raffles: [] })
    }

    console.log("We get here: ", roundCountBN)

    // 2️⃣ Attempt to fetch each as an active round
    const roundIds = [...Array(total).keys()].map(i => BigInt(i + 1))
    const roundsRaw: any[] = await publicClient.multicall({
      contracts: roundIds.map(id => ({
        address: RAFFLE,
        abi: raffleAbi.abi as Abi,
        functionName: 'getActiveRound',
        args: [id],
      })),
      allowFailure: true,
    })

    console.log("We get here too: ", roundsRaw);

    // 3️⃣ Shape results, drop inactive (failed) calls
  // 3️⃣ Unwrap and shape only successful calls
  interface RawResp { status: 'success' | 'failure'; result: unknown[] }
  const base = roundIds
    .map((id, i) => {
      const entry = roundsRaw[i] as RawResp
      if (entry.status !== 'success') return null


      const r = entry.result as [
        bigint, // startTime
        bigint, // endTime
        bigint, // maxTickets
        bigint, // totalTickets
        Address,// rewardToken
        bigint, // rewardPool
        bigint, // ticketCostPoints
        boolean // winnersSelected
      ]

      const now = BigInt(Math.floor(Date.now() / 1000));
      if (r[1] /* endTime */ <= now) return null;  

      return {
        id:            id.toString(),
        starts:        Number(r[0]),
        ends:          Number(r[1]),
        maxTickets:    Number(r[2]),
        totalTickets:  Number(r[3]),
        rewardToken:   r[4],
        rewardPool:    formatUnits(r[5], 18),
        ticketCost:    formatUnits(r[6],18),
        winnersSelected: r[7],
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

    const raffles = await Promise.all(
      base.map(async (rf) => {
       
         const symbol: any = await publicClient.readContract({
            address: rf.rewardToken,
            abi: erc20Abi.abi,
            functionName: 'symbol',
          }) 
       
        console.log(symbol)
        return { ...rf, symbol }
      })
    )
  

    return NextResponse.json({ raffles })
  } catch (err) {
    console.error('[raffle_display] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch raffles' },
      { status: 500 }
    )
  }
}
