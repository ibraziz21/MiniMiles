import { createClient } from "@supabase/supabase-js"
import { createWalletClient, createPublicClient, http, parseAbiItem, parseEther, parseUnits } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { celoAlfajores } from "viem/chains"
import { NextResponse } from "next/server"
import cUSDAbi from "@/contexts/cusd-abi.json" // minimal ABI for Transfer event
import MiniPointsAbi from "@/contexts/minimiles.json"

const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ""  // or ANON_KEY
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""
const MINIPOINTS_ADDRESS = process.env.MINIPOINTS_ADDRESS || ""
const CUSD_ADDRESS = process.env.CUSD_ADDRESS || "" // e.g. 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1 (Alfajores cUSD)
const USDC_ADDRESS = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B"

// Safety check for required envs
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_KEY ||
  !PRIVATE_KEY ||
  !MINIPOINTS_ADDRESS ||
  !CUSD_ADDRESS
) {
  console.error("[DAILY-CUSD] Missing environment variables.")
  throw new Error("Missing config for daily cUSD quest.")
}

// 1. Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 2. viem clients
const account = privateKeyToAccount(`0x${PRIVATE_KEY}`)
const publicClient = createPublicClient({ chain: celoAlfajores, transport: http() })
const walletClient = createWalletClient({ account, chain: celoAlfajores, transport: http() })


export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json()
    const addresses = [USDC_ADDRESS,CUSD_ADDRESS]
    console.log("[DAILY-CUSD] Checking claim for:", userAddress)


    // 1) Has user already claimed today?
    const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
    const { data: claimed, error } = await supabase
      .from("daily_engagements")
      .select("*")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claimed_at", today)
      .maybeSingle()

    if (claimed) {
      return NextResponse.json({ success: false, message: "Already claimed today" })
    }

    let anySpent = false
    for (const token of addresses) {
      if (await hasUserReceivedAtLeast5CusdIn24Hrs(userAddress, token)) {
        anySpent = true
        break
      }
    }
    if (!anySpent) {
      console.log("No qualifying transfer found across any token")
      return NextResponse.json({
        success: false,
        message: `No on-chain transfer ≥ 5 found in the last 24 hours for any tracked token`,
      })
    }


    // 3) Mint points
    const { request } = await publicClient.simulateContract({
      address: MINIPOINTS_ADDRESS as `0x${string}`,
      abi: MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("5",18)],
      account: account.address,
    })
    const txHash = await walletClient.writeContract({
      ...request,           // to, data, gas, etc.
      account,              // <-- full account object, so Viem can sign
      chain:   celoAlfajores,   // (optional) but avoids auto-detect
    })
    console.log("[DAILY-CUSD] Mint Tx:", txHash)

    // 4) Log claim in DB
    await supabase.from("daily_engagements").insert({
      user_address: userAddress,
      quest_id: questId,
      claimed_at: today,
      points_awarded: 5,
    })

    return NextResponse.json({ success: true, txHash })
  } catch (err) {
    console.error("[DAILY-CUSD] Error:", err)
    return NextResponse.json({ success: false, message: "Daily cUSD claim failed" })
  }
}

/**
 * Checks if user transferred >= 5 cUSD in the last 24 hours.
 */
async function hasUserReceivedAtLeast5CusdIn24Hrs(userAddress: string, tokenAddress: string): Promise<boolean> {
  // We'll approximate 24 hours as ~17280 blocks on Alfajores (5s block time).
  // You may want a more robust "block by timestamp" approach for exactness.
  const latestBlock = await publicClient.getBlockNumber()
  const blocksPer24Hours = BigInt(17280)
  const fromBlock = latestBlock > blocksPer24Hours ? latestBlock - blocksPer24Hours : 0n

  // 1. Fetch logs from cUSD's Transfer event
  // cUSD Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
  const logs = await publicClient.getLogs({
    address: tokenAddress as `0x${string}`, // minimal ABI that has 'Transfer' event
    event:parseAbiItem('event Transfer(address indexed from, address indexed to, uint256)'),
    fromBlock,
    toBlock: "latest",
    // We'll filter in code for 'from = userAddress' and 'value >= 5 * 1e18'
  })

  if (!logs.length) return false

  const TOKEN_DECIMALS: Record<string, number> = {
    [USDC_ADDRESS]: 6,
    [CUSD_ADDRESS]: 18,
  };
  const decimals = TOKEN_DECIMALS[tokenAddress] ?? 18;
const FIVE = parseUnits("5", decimals);
  for (let log of logs) {
    if (
      log.args[1]?.toLowerCase() === userAddress.toLowerCase() &&
      log.args[2]! >= FIVE
    ) {
      // We also want to ensure it was within last 24 hours by block timestamp
      const block = await publicClient.getBlock({ blockNumber: log.blockNumber })
      if (!block.timestamp) continue

      const blockTimeSeconds = Number(block.timestamp)
      const nowSeconds = Math.floor(Date.now() / 1000)
      if (nowSeconds - blockTimeSeconds <= 86400) {
        // Found a matching Tx within 24 hours
        return true
      }
    }
  }

  return false
}
