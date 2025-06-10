// src/app/api/quests/daily_five_txs/route.ts
import { createClient }          from "@supabase/supabase-js";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbiItem,
  parseUnits,
} from "viem";
import { privateKeyToAccount }   from "viem/accounts";
import { celo }         from "viem/chains";
import { NextResponse }          from "next/server";
import MiniPointsAbi             from "@/contexts/minimiles.json";

// ───── env & constants ────────────────────────────────────────────────────────
const {
  SUPABASE_URL           = "",
  SUPABASE_SERVICE_KEY   = "",
  PRIVATE_KEY            = "",
  MINIPOINTS_ADDRESS     = "",
  CUSD_ADDRESS           = "",                          // Alfajores cUSD
} = process.env;

const USDC_ADDRESS = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B";
const TOKENS_TO_TRACK = [CUSD_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()];

// env-guard
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PRIVATE_KEY || !MINIPOINTS_ADDRESS || !CUSD_ADDRESS) {
  console.error("[DAILY-5TX] Missing environment variables");
  throw new Error("Config incomplete – check env");
}

// ───── clients ────────────────────────────────────────────────────────────────
const supabase     = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const account      = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

// ───── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();


    /* 1️⃣  already claimed today? */
    const today = new Date().toISOString().slice(0, 10);
    const { data: claimed } = await supabase
      .from("daily_engagements")
      .select("id")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .eq("claimed_at", today)
      .maybeSingle();

    if (claimed) {
      return NextResponse.json({ success: false, message: "Already claimed today" });
    }

    /* 2️⃣  Has user SENT at least 5 transfers in last 24 h across the tokens? */
    const MIN_TXS_REQUIRED = 5;
    const totalTxs = await countTransfersIn24H(userAddress.toLowerCase());
    if (totalTxs < MIN_TXS_REQUIRED) {
      return NextResponse.json({
        success: false,
        message: `Only ${totalTxs}/5 transfers found in the last 24 h`,
      });
    }

    /* 3️⃣  Mint MiniMiles (e.g. 20) to the user */
    const { request } = await publicClient.simulateContract({
      address: MINIPOINTS_ADDRESS as `0x${string}`,
      abi:     MiniPointsAbi.abi,
      functionName: "mint",
      args: [userAddress, parseUnits("20", 18)],
      account,
    });
    const txHash = await walletClient.writeContract({ ...request, account, chain: celo });


    /* 4️⃣  Save engagement */
    await supabase.from("daily_engagements").insert({
      user_address:  userAddress,
      quest_id:      questId,
      claimed_at:    today,
      points_awarded: 20,
    });

    return NextResponse.json({ success: true, txHash });
  } catch (err) {
    console.error("[DAILY-5TX] Error:", err);
    return NextResponse.json({ success: false, message: "Quest failed" });
  }
}

// ───── helper: count transfers ────────────────────────────────────────────────
async function countTransfersIn24H(user: string): Promise<number> {
  const latest      = await publicClient.getBlockNumber();
  const fromBlock   = latest > 17_280n ? latest - 17_280n : 0n;   // ~24 h on Alfajores
  const transferAbi = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256)");

  let total = 0;
  for (const token of TOKENS_TO_TRACK) {
    const logs = await publicClient.getLogs({
      address: token as `0x${string}`,
      event:   transferAbi,
      fromBlock,
      toBlock: "latest",
    });

    for (const log of logs) {
      if (log.args[0]?.toLowerCase() === user) {
        // timestamp filter – rare to need because block delta covers 24 h,
        // but we’ll keep it for precision:
        const blk = await publicClient.getBlock({ blockNumber: log.blockNumber });
        const age = Math.floor(Date.now() / 1000) - Number(blk.timestamp ?? 0n);
        if (age <= 86_400) {
          total += 1;
          if (total >= 5) return total;      // early exit
        }
      }
    }
  }
  return total;
}
