// src/app/api/spend/join_raffle/route.ts
import { NextResponse } from "next/server"
import { createPublicClient, http, type Abi } from "viem"
import { celo } from "viem/chains"
import raffleAbi from "@/contexts/miniraffle.json"

const RAFFLE_ADDRESS = "0x46dE92B184776D1BebD7c95D8CC085009280E4f6"

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
})




export async function POST(req: Request) {
  try {

    const { roundId, ticketCount, userAddress } = await req.json()

    // sanity‐check inputs
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
