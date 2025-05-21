import { createClient } from "@supabase/supabase-js"
import { createWalletClient, http, createPublicClient, parseUnits } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia, celoAlfajores } from "viem/chains" // change this to your chain
import MiniPointsAbi from "@/contexts/minimiles.json" // adjust path
import * as dotenv from "dotenv";
dotenv.config();

// ENVIRONMENT VARIABLES
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_KEY || ""
const PRIVATE_KEY = process.env.PRIVATE_KEY || "" // make sure this is secure
const CONTRACT_ADDRESS = "0x9a51F81DAcEB772cC195fc8551e7f2fd7c62CD57"


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`)


const chain = celoAlfajores
const publicClient = createPublicClient({
  chain,
  transport: http(),
})


const client = createWalletClient({
  account,
  chain: celoAlfajores, // or your custom config
  transport: http(),
})

export async function POST(req: Request) {
  const { userAddress, questId } = await req.json()
  console.log("let's go")

  const today = new Date().toISOString().slice(0, 10) // e.g., 2025-04-15
  console.log("checking for: ", userAddress)
  // Check Supabase: already claimed?
  const { data: claimed, error } = await supabase
    .from("daily_engagements")
    .select("*")
    .eq("user_address", userAddress)
    .eq("quest_id", questId)
    .eq("claimed_at", today)
    .maybeSingle()

  if (claimed) {
    console.log("Already Claimed")
    return Response.json({ success: false, message: "Already claimed today" })
  }

  try {
    // Call mintPoints(userAddress, 5)
    const { request } = await publicClient.simulateContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("10",18)],
      account,
    })

    const txHash = await client.writeContract(request)

    // Log claim in Supabase
    await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: today,
      points_awarded: 10,
    })

    return Response.json({ success: true, txHash })
  } catch (err: any) {
    console.error("Minting failed", err)
    return Response.json({ success: false, message: "Error minting points" })
  }
}
