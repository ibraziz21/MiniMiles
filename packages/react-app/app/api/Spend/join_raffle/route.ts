// src/app/api/spend/join_raffle/route.ts
import { NextResponse } from "next/server"
import { createPublicClient, http, type Abi } from "viem"
import { celo } from "viem/chains"
import raffleAbi from "@/contexts/miniraffle.json"
import { requireSession } from "@/lib/auth"
import { isBlacklisted } from "@/lib/blacklist"
import {
  evaluateRaffleRequirements,
  getRaffleRequirementConfig,
} from "@/lib/raffleRequirements"

const RAFFLE_ADDRESS = "0xD75dfa972C6136f1c594Fec1945302f885E1ab29"

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
})




export async function POST(req: Request) {
  try {

    const { roundId, ticketCount, userAddress } = await req.json()

    // sanity-check inputs
    if (
      typeof roundId !== "number" ||
      typeof ticketCount !== "number" ||
      roundId <= 0 ||
      ticketCount <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid roundId or ticketCount" },
        { status: 400 }
      )
    }

    if (typeof userAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return NextResponse.json(
        { error: "Invalid userAddress" },
        { status: 400 },
      )
    }

    if (await isBlacklisted(userAddress, "Spend/join_raffle")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (await getRaffleRequirementConfig(roundId)) {
      const session = await requireSession()
      if (!session || session.walletAddress !== userAddress.toLowerCase()) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 },
        )
      }

      const requirements = await evaluateRaffleRequirements(roundId, session.walletAddress)
      if (requirements.eligible !== true) {
        return NextResponse.json(
          {
            error: requirements.message ?? "You do not meet this raffle's requirements yet.",
            requirements,
          },
          { status: 403 },
        )
      }
    }

    // simulate the call, to get the unsigned tx request
    const { request } = await publicClient.simulateContract({
      address: RAFFLE_ADDRESS as `0x${string}`,
      abi: raffleAbi.abi as Abi,
      functionName: "joinRaffle",
      args: [BigInt(roundId), BigInt(ticketCount)],
      account: userAddress as `0x${string}`,
    })

    return NextResponse.json({ request})
  } catch (err: any) {
    console.error("[join_raffle] error", err)
    return NextResponse.json(
      { error: err.message ?? "Failed to simulate joinRaffle" },
      { status: 500 }
    )
  }
}
