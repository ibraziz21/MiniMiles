// src/app/api/spend/raffle_display/route.ts
import { NextResponse } from 'next/server'
import { createPublicClient, formatUnits, http, type Abi, type Address } from 'viem'
import { celo } from 'viem/chains'
import { createClient } from '@supabase/supabase-js'
import raffleAbi from '@/contexts/miniraffle.json'
import erc20Abi from '@/contexts/cusd-abi.json' // must include symbol(), decimals()

const RAFFLE: Address = '0xd75dfa972c6136f1c594fec1945302f885e1ab29'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const PRIORITY_TOKEN = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e'.toLowerCase() // USDT on Celo

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
})

// Server-side Supabase client — service key never leaves the server
function getSupabase() {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_KEY ?? ''
  return createClient(url, key)
}

// ── Supabase fetchers ────────────────────────────────────────────────────────

type RaffleMeta = {
  round_id: number
  kind: string | null
  card_title: string | null
  prize_title: string | null
  description: string | null
  card_image_url: string | null
  winners: number
}

type RaffleRequirementRow = {
  round_id: number
  mode: 'all' | 'any'
  gates: Array<{ type: string; minUsd?: number }>
  enabled: boolean
}

async function fetchMetaForRounds(roundIds: number[]): Promise<Map<number, RaffleMeta>> {
  const map = new Map<number, RaffleMeta>()
  if (roundIds.length === 0) return map
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('raffle_meta')
      .select('round_id, kind, card_title, prize_title, description, card_image_url, winners')
      .in('round_id', roundIds)
    for (const row of data ?? []) map.set(row.round_id, row as RaffleMeta)
  } catch (err) {
    console.warn('[raffle_display] raffle_meta fetch failed', err)
  }
  return map
}

async function fetchRequirementsForRounds(roundIds: number[]): Promise<Map<number, RaffleRequirementRow>> {
  const map = new Map<number, RaffleRequirementRow>()
  if (roundIds.length === 0) return map
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('raffle_requirements')
      .select('round_id, mode, gates, enabled')
      .in('round_id', roundIds)
      .eq('enabled', true)
    for (const row of data ?? []) map.set(row.round_id, row as RaffleRequirementRow)
  } catch (err) {
    console.warn('[raffle_display] raffle_requirements fetch failed', err)
  }
  return map
}

// ── Requirement shape for the API response ───────────────────────────────────

function gateLabel(gate: { type: string; minUsd?: number }): string {
  if (gate.type === 'min_usdt_balance') return `Hold at least ${gate.minUsd ?? 10} USDT`
  if (gate.type === 'prosperity_pass_holder') return 'Hold a Prosperity Pass'
  return "Complete today's 5-transfer quest"
}

function buildRequirementsShape(row: RaffleRequirementRow | undefined, roundId: number) {
  if (!row || !Array.isArray(row.gates) || row.gates.length === 0) return null
  return {
    roundId,
    gated: true,
    eligible: null as null, // unknown until user is identified in the sheet
    mode: row.mode,
    gates: row.gates.map((gate) => ({ type: gate.type, label: gateLabel(gate) })),
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // 1) Read total rounds
    const roundCountBN = await publicClient.readContract({
      address: RAFFLE,
      abi: raffleAbi.abi as Abi,
      functionName: 'roundIdCounter',
    })
    const total = Number(roundCountBN)

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
          boolean,  // winnersSelected
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

    const activeRoundIds = base.map((rf) => rf.id)

    // 4) Fetch Supabase metadata in parallel
    const [metaMap, reqMap] = await Promise.all([
      fetchMetaForRounds(activeRoundIds),
      fetchRequirementsForRounds(activeRoundIds),
    ])

    // 5) Split into physical vs token raffles
    const physicalBase = base.filter(rf => rf.rewardToken.toLowerCase() === ZERO_ADDR)
    const tokenBase    = base.filter(rf => rf.rewardToken.toLowerCase() !== ZERO_ADDR)

    // (Optional) read prizeNFT address for physicals
    let prizeNFT: Address | undefined
    try {
      prizeNFT = await publicClient.readContract({
        address: RAFFLE,
        abi: raffleAbi.abi as Abi,
        functionName: 'prizeNFT',
      }) as Address
    } catch { /* no-op if not exposed */ }

    // 6) Enrich token raffles with symbol/decimals and Supabase meta
    const tokenRaffles = await Promise.all(
      tokenBase.map(async (rf) => {
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

        let symbol = 'TOKEN'
        try {
          symbol = await publicClient.readContract({
            address: rf.rewardToken,
            abi: erc20Abi.abi as Abi,
            functionName: 'symbol',
          }) as string
        } catch { /* keep fallback */ }

        const meta = metaMap.get(rf.id)
        const req  = reqMap.get(rf.id)

        return {
          id: rf.id,
          starts: rf.starts,
          ends: rf.ends,
          maxTickets: rf.maxTickets,
          totalTickets: rf.totalTickets,
          winnersSelected: rf.winnersSelected,
          token: { address: rf.rewardToken, symbol, decimals },
          rewardPool: formatUnits(rf.rewardPoolRaw, decimals),
          ticketCost: formatUnits(rf.ticketCostRaw, 18),
          raffleType: 'token',
          // Supabase meta — fallback to 1 winner if no row
          winners:      meta?.winners ?? 1,
          cardTitle:    meta?.card_title ?? null,
          prizeTitle:   meta?.prize_title ?? null,
          description:  meta?.description ?? null,
          cardImageUrl: meta?.card_image_url ?? null,
          requirements: buildRequirementsShape(req, rf.id),
        }
      })
    )

    // Sort: PRIORITY_TOKEN first
    tokenRaffles.sort((a, b) => {
      const aP = a.token.address.toLowerCase() === PRIORITY_TOKEN
      const bP = b.token.address.toLowerCase() === PRIORITY_TOKEN
      if (aP && !bP) return -1
      if (!aP && bP) return 1
      return 0
    })

    // 7) Shape physical raffles
    const physicalRaffles = physicalBase.map((rf) => {
      const meta = metaMap.get(rf.id)
      const req  = reqMap.get(rf.id)
      return {
        id: rf.id,
        starts: rf.starts,
        ends: rf.ends,
        maxTickets: rf.maxTickets,
        totalTickets: rf.totalTickets,
        winnersSelected: rf.winnersSelected,
        prizeNFT,
        ticketCost: formatUnits(rf.ticketCostRaw, 18),
        raffleType: 'physical',
        winners:      meta?.winners ?? 1,
        cardTitle:    meta?.card_title ?? null,
        prizeTitle:   meta?.prize_title ?? null,
        description:  meta?.description ?? null,
        cardImageUrl: meta?.card_image_url ?? null,
        requirements: buildRequirementsShape(req, rf.id),
      }
    })

    return NextResponse.json({ tokenRaffles, physicalRaffles })
  } catch (err) {
    console.error('[raffle_display] error:', err)
    return NextResponse.json({ error: 'Failed to fetch raffles' }, { status: 500 })
  }
}
