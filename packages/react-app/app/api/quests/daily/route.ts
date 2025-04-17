import { createClient } from "@supabase/supabase-js"
import { createWalletClient, http, createPublicClient } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia, celoAlfajores } from "viem/chains" // change this to your chain
import MiniPointsAbi from "@/contexts/minimiles.json" // adjust path
import * as dotenv from "dotenv";
dotenv.config();

// ENVIRONMENT VARIABLES
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_KEY || ""
const PRIVATE_KEY = process.env.PRIVATE_KEY || "" // make sure this is secure
const CONTRACT_ADDRESS = "0xcEb2caAc90F5B71ecb9a5f3149586b76C9811a76"


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`)


const chain = celoAlfajores
const publicClient = createPublicClient({
  chain,
  transport: http(),
})
console.log("accunt: ", account)

const client = createWalletClient({
  account,
  chain: celoAlfajores, // or your custom config
  transport: http(),
})

export async function POST(req: Request) {
  const { userAddress, questId } = await req.json()
  console.log("let's go")

  const today = new Date().toISOString().slice(0, 10) // e.g., 2025-04-15

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
      args: [userAddress, 5],
      account,
    })

    const txHash = await client.writeContract(request)

    // Log claim in Supabase
    await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: today,
      points_awarded: 5,
    })

    return Response.json({ success: true, txHash })
  } catch (err: any) {
    console.error("Minting failed", err)
    return Response.json({ success: false, message: "Error minting points" })
  }
}
