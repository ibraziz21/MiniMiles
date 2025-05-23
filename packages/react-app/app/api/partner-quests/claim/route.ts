// app/api/partner-quests/claim/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import MiniPointsAbi from '@/contexts/minimiles.json'
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celoAlfajores } from 'viem/chains'

// ── ENV & CLIENT SETUP ────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`)

const publicClient = createPublicClient({
  chain: celoAlfajores,
  transport: http(),
})

const walletClient = createWalletClient({
  account,
  chain: celoAlfajores,
  transport: http(),
})

const CONTRACT_ADDRESS = '0x9a51F81DAcEB772cC195fc8551e7f2fd7c62CD57'

// ── POST HANDLER ─────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { userAddress, questId } = await request.json() as {
      userAddress?: string
      questId?: string
    }

    if (!userAddress || !questId) {
      return NextResponse.json(
        { error: 'userAddress and questId are required' },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)

    // 1. Prevent double-claim
    const { data: existing, error: checkErr } = await supabase
      .from('partner_engagements')
      .select('id', { count: 'exact' })
      .eq('user_address', userAddress)
      .eq('partner_quest_id', questId)
      .eq('claimed_at', today)
      .limit(1)

    if (checkErr) {
      console.error('DB check error:', checkErr)
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      )
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'Already claimed today' },
        { status: 400 }
      )
    }

    // 2. Fetch the point value
    const {
      data: quest,
      error: questErr,
    } = await supabase
      .from('partner_quests')
      .select('reward_points')
      .eq('id', questId)
      .single()

    if (questErr || !quest) {
      console.error('Quest lookup error:', questErr)
      return NextResponse.json(
        { error: 'Quest not found' },
        { status: 404 }
      )
    }

    const points = quest.reward_points

    // 3. Simulate & send mint transaction
    const { request: txRequest } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: 'mint',
      args: [userAddress, parseUnits(points.toString(), 18)],
      account: account,
    })

    const txHash = await walletClient.writeContract(txRequest)

    // 4. Record the engagement
    const { error: insertErr } = await supabase
      .from('partner_engagements')
      .insert({
        user_address: userAddress,
        partner_quest_id: questId,
        claimed_at: today,
        points_awarded: points,
      })

    if (insertErr) {
      console.error('Insert error:', insertErr)
      return NextResponse.json(
        { error: 'Could not record engagement' },
        { status: 500 }
      )
    }

    // 5. Success
    return NextResponse.json(
      { minted: points, txHash },
      { status: 200 }
    )
  } catch (err) {
    console.error('Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
