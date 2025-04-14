// src/questChecks.ts
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";
import * as dotenv from "dotenv";
dotenv.config();

const CELO_RPC_URL = process.env.CELO_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const MINIPOINTS_ADDRESS = process.env.MINIPOINTS_ADDRESS || "";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "";

const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Minimal ABI for your MiniPoints
const MINIPOINTS_ABI = [
  "function mint(address account, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)"
];

// Minimal ERC20 ABI
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

export const miniPoints = new ethers.Contract(MINIPOINTS_ADDRESS, MINIPOINTS_ABI, wallet);
const usdtToken = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

function getTodayDateString(): string {
    return new Date().toISOString().split("T")[0];
  }


  export async function hasOpenedMinimilesToday(userAddress: string): Promise<boolean> {
    const today = getTodayDateString();
  
    const { data, error } = await supabase
      .from("user_actions")
      .select("id")
      .eq("user_address", userAddress)
      .eq("action_type", "open_minimiles")
      .gte("created_at", `${today}T00:00:00`)  // same day, from midnight
      .lte("created_at", `${today}T23:59:59`)  // same day, until 23:59:59
      .limit(1); // we just need to see if at least 1 row
  
    if (error) {
      console.error("hasOpenedMinimilesToday error:", error);
      return false;
    }
    // If we found at least one row, user did open Minimiles
    return (data && data.length > 0);
  }

  /**
 * Check if user received a payment above $5 today.
 * We look for action_type = "receive_payment" with amount >= 5.
 */
export async function hasReceivedPaymentAbove5(userAddress: string): Promise<boolean> {
    const today = getTodayDateString();
  
    const { data, error } = await supabase
      .from("user_actions")
      .select("amount")
      .eq("user_address", userAddress)
      .eq("action_type", "receive_payment")
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`)
      .gte("amount", 5)   // must be >= 5
      .limit(1);
  
    if (error) {
      console.error("hasReceivedPaymentAbove5 error:", error);
      return false;
    }
    return (data && data.length > 0);
  }


  /**
 * Check if user sent a $5+ payment today.
 */
export async function hasSentPaymentAbove5(userAddress: string): Promise<boolean> {
    const today = getTodayDateString();
  
    const { data, error } = await supabase
      .from("user_actions")
      .select("amount")
      .eq("user_address", userAddress)
      .eq("action_type", "send_payment")
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`)
      .gte("amount", 5)
      .limit(1);
  
    if (error) {
      console.error("hasSentPaymentAbove5 error:", error);
      return false;
    }
    return (data && data.length > 0);
  }


/**
 * Check if user performed any minipay action today (besides open/receive/send).
 * We'll interpret action_type = "minipay_action" and it can be anything you define.
 */
export async function hasDoneOneMinipayAction(userAddress: string): Promise<boolean> {
    const today = getTodayDateString();
  
    const { data, error } = await supabase
      .from("user_actions")
      .select("id")
      .eq("user_address", userAddress)
      .eq("action_type", "minipay_action")
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`)
      .limit(1);
  
    if (error) {
      console.error("hasDoneOneMinipayAction error:", error);
      return false;
    }
    return (data && data.length > 0);
  }
  
  
/**
 * Checks if user has 25 or more outgoing transactions.
 */
export async function has25Transactions(userAddress: string): Promise<boolean> {
  const txCount = await provider.getTransactionCount(userAddress);
  return txCount >= 25;
}

/**
 * Checks if user has done at least one USDT transfer >= 5 tokens.
 * This naive approach queries logs for a range of blocks. 
 * Adjust block range or indexing strategy for your production environment.
 */
export async function hasTransferred5USDT(userAddress: string): Promise<boolean> {
  const currentBlock = await provider.getBlockNumber();
  // For demonstration, we check the last 200000 blocks (~some range).
  // Tweak this if you want a shorter or longer range, or keep an index server.
  const startBlock = currentBlock - 200000;
  if (startBlock < 0) {
    // if on a testnet with fewer blocks, clamp to 0
    return false;
  }

  // Filter logs where `from = userAddress`
  const filter = {
    address: USDT_ADDRESS,
    fromBlock: startBlock,
    toBlock: currentBlock,
    topics: [
      ethers.id("Transfer(address,address,uint256)"),
      ethers.zeroPadBytes(userAddress, 32)
    ]
  };

  const logs = await provider.getLogs(filter);
  for (const log of logs) {
    // parse the log
    const parsed = usdtToken.interface.parseLog(log);
    if (!parsed) continue;
    // Transfer event => [from, to, value]
    const value = parsed.args.value as bigint;

    // If >= 5 * 1e18 (assuming 18 decimals)
    if (value >= ethers.parseUnits("5", 18)) {
      return true;
    }
  }
  return false;
}

/**
 * Mints MiniPoints to the user from the owner wallet.
 */
export async function mintMiniPoints(userAddress: string, amount: bigint) {
  const tx = await miniPoints.mint(userAddress, amount);
  console.log(`Minting ${amount} points to ${userAddress}, txHash = ${tx.hash}`);
  await tx.wait();
  console.log("Mint confirmed");
}
