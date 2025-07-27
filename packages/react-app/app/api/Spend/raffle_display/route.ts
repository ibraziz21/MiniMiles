// src/app/api/spend/raffle_display/route.ts
import { NextResponse } from 'next/server'
import { createPublicClient, formatUnits, http, parseUnits, type Abi } from 'viem'
import { celo } from 'viem/chains'
import raffleAbi from '@/contexts/miniraffle.json' 
import erc20Abi from '@/contexts/cusd-abi.json'      // must include getActiveRound
import type { Address } from 'viem'

const RAFFLE: Address = '0xD75dfa972C6136f1c594Fec1945302f885E1ab29'

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
})

export async function GET() {
  const PRIORITY_TOKEN =
  '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e'.toLowerCase();
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

    // 3️⃣ Shape results, drop inactive (failed) calls
  // 3️⃣ Unwrap and shape only successful calls
  interface RawResp { status: 'success' | 'failure'; result: unknown[] }
  const base = roundIds
    .map((id, i) => {
      const entry = roundsRaw[i] as RawResp
      if (entry.status !== 'success') return null


      const r = entry.result as [
        bigint,   //roundId
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
      if (r[2] /* endTime */ <= now) return null;  

      if (r[6] === 0n) return null;  
      const decimal = r[5] == '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'? 6 : 18


      return {
        id:            Number(r[0]),
        starts:        Number(r[1]),
        ends:          Number(r[2]),
        maxTickets:    Number(r[3]),
        totalTickets:  Number(r[4]),
        rewardToken:   r[5],
        rewardPool:    formatUnits(r[6],decimal),
        ticketCost:    formatUnits(r[7],18),
        winnersSelected: r[8],
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
       

        return { ...rf, symbol }
      })
    )
    raffles.sort((a, b) => {
      const aIsPriority = a.rewardToken.toLowerCase() === PRIORITY_TOKEN;
      const bIsPriority = b.rewardToken.toLowerCase() === PRIORITY_TOKEN;
      if (aIsPriority && !bIsPriority) return -1;  // a first
      if (!aIsPriority && bIsPriority) return  1;  // b first
      return 0;                                   // keep relative order
    });
    
    return NextResponse.json({ raffles });
  

  } catch (err) {
    console.error('[raffle_display] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch raffles' },
      { status: 500 }
    )
  }
}
