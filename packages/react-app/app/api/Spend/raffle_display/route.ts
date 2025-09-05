// src/app/api/spend/raffle_display/route.ts
import { NextResponse } from 'next/server'
import { createPublicClient, formatUnits, http, type Abi, type Address } from 'viem'
import { celo } from 'viem/chains'
import raffleAbi from '@/contexts/miniraffle.json'
import erc20Abi from '@/contexts/cusd-abi.json' // must include symbol(), decimals()

const RAFFLE: Address = '0xd75dfa972c6136f1c594fec1945302f885e1ab29'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const PRIORITY_TOKEN = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e'.toLowerCase() // USDT on Alfajores

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
})

export async function GET() {
  try {
    // 1) Read total rounds
    const roundCountBN = await publicClient.readContract({
      address: RAFFLE,
      abi: raffleAbi.abi as Abi,
      functionName: 'roundIdCounter',
    })
    const total = Number(roundCountBN)
    console.log("total rounds:", total)
    if (total === 0) {
      return NextResponse.json({ tokenRaffles: [], physicalRaffles: [] })
    }



    // 2) Fetch each as "active" (allow failures for inactive/expired)
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

    console.log("ROUNDS: ",roundsRaw)

    // 3) Unwrap successful + still-active (endTime > now)
    interface RawResp { status: 'success' | 'failure'; result: unknown[] }
    const now = BigInt(Math.floor(Date.now() / 1000))

    const base = roundIds
      .map((id, i) => {
        const entry = roundsRaw[i] as RawResp
        if (entry?.status !== 'success') return null

        const r = entry.result as [
          bigint,   // roundId
          bigint,   // startTime
          bigint,   // endTime
          bigint,   // maxTickets
          bigint,   // totalTickets
          Address,  // rewardToken (ZERO_ADDR for physical)
          bigint,   // rewardPool (raw)
          bigint,   // ticketCostPoints (raw, 18d)
          boolean   // winnersSelected
        ]

        if (!r || r[2] <= now) return null

        return {
          id:            Number(r[0]),
          starts:        Number(r[1]),
          ends:          Number(r[2]),
          maxTickets:    Number(r[3]),
          totalTickets:  Number(r[4]),
          rewardToken:   r[5] as Address,
          rewardPoolRaw: r[6] as bigint,
          ticketCostRaw: r[7] as bigint,
          winnersSelected: r[8] as boolean,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // 4) Split into physical vs token raffles
    const physicalBase = base.filter(rf => rf.rewardToken.toLowerCase() === ZERO_ADDR)
    const tokenBase    = base.filter(rf => rf.rewardToken.toLowerCase() !== ZERO_ADDR)

    // (Optional) read prizeNFT address for physicals (ignore if not present in ABI)
    let prizeNFT: Address | undefined
    try {
      prizeNFT = await publicClient.readContract({
        address: RAFFLE,
        abi: raffleAbi.abi as Abi,
        functionName: 'prizeNFT',
      }) as Address
    } catch { /* no-op if not exposed */ }

    // 5) Enrich token raffles with symbol/decimals and format values
    const tokenRaffles = await Promise.all(
      tokenBase.map(async (rf) => {
        // read decimals with fallback to 18
        let decimals = 18
        try {
          decimals = Number(
            await publicClient.readContract({
              address: rf.rewardToken,
              abi: erc20Abi.abi as Abi,
              functionName: 'decimals',
            })
          )
        } catch { /* fallback stays 18 */ }

        // read symbol with fallback to 'TOKEN'
        let symbol = 'TOKEN'
        try {
          symbol = await publicClient.readContract({
            address: rf.rewardToken,
            abi: erc20Abi.abi as Abi,
            functionName: 'symbol',
          }) as string
        } catch { /* keep fallback */ }

        return {
          id: rf.id,
          starts: rf.starts,
          ends: rf.ends,
          maxTickets: rf.maxTickets,
          totalTickets: rf.totalTickets,
          winnersSelected: rf.winnersSelected,
          token: {
            address: rf.rewardToken,
            symbol,
            decimals,
          },
          rewardPool: formatUnits(rf.rewardPoolRaw, decimals),
          ticketCost: formatUnits(rf.ticketCostRaw, 18), // MiniPoints assumed 18d
          raffleType: 'token', // 0/1/2
        }
      })
    )

    // sort token raffles by PRIORITY_TOKEN first
    tokenRaffles.sort((a, b) => {
      const aP = a.token.address.toLowerCase() === PRIORITY_TOKEN
      const bP = b.token.address.toLowerCase() === PRIORITY_TOKEN
      if (aP && !bP) return -1
      if (!aP && bP) return 1
      return 0
    })

    // 6) Shape physical raffles (no ERC-20 metadata; rewardPool is 0 by construction)
    const physicalRaffles = physicalBase.map((rf) => ({
      id: rf.id,
      starts: rf.starts,
      ends: rf.ends,
      maxTickets: rf.maxTickets,
      totalTickets: rf.totalTickets,
      winnersSelected: rf.winnersSelected,
      prizeNFT: prizeNFT,                 // may be undefined if getter not available
      ticketCost: formatUnits(rf.ticketCostRaw, 18),
      raffleType: 'physical',             // == 3
    }))

    return NextResponse.json({ tokenRaffles, physicalRaffles })
  } catch (err) {
    console.error('[raffle_display] error:', err)
    return NextResponse.json({ error: 'Failed to fetch raffles' }, { status: 500 })
  }
}
