// src/questChecks.ts
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";
import * as dotenv from "dotenv";
dotenv.config();

const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";
const MINIPOINTS_ADDRESS = process.env.MINIPOINTS_ADDRESS || "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "";

// Minimal ABI for your MiniPoints
const MINIPOINTS_ABI = [
  "function mint(address account, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)"
];

// Minimal ERC20 ABI
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Lazy-initialize so a missing/invalid key doesn't crash the whole process on import
let _provider: ethers.JsonRpcProvider | null = null;
let _wallet: ethers.Wallet | null = null;
let _miniPoints: ethers.Contract | null = null;
let _usdtToken: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) _provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
  return _provider;
}

function getWallet(): ethers.Wallet {
  if (!_wallet) {
    const raw = (process.env.RETRY_PK ?? process.env.PRIVATE_KEY ?? "").trim();
    if (!raw) throw new Error("No PRIVATE_KEY or RETRY_PK set");
    const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
    _wallet = new ethers.Wallet(pk, getProvider());
  }
  return _wallet;
}

export function getMiniPoints(): ethers.Contract {
  if (!_miniPoints) _miniPoints = new ethers.Contract(MINIPOINTS_ADDRESS, MINIPOINTS_ABI, getWallet());
  return _miniPoints;
}

function getUsdtToken(): ethers.Contract {
  if (!_usdtToken) _usdtToken = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, getProvider());
  return _usdtToken;
}

/** @deprecated use the mint queue instead */
export const miniPoints = { mint: (...args: any[]) => getMiniPoints().mint(...args) };

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
  const txCount = await getProvider().getTransactionCount(userAddress);
  return txCount >= 25;
}

/**
 * Checks if user has done at least one USDT transfer >= 5 tokens.
 * This naive approach queries logs for a range of blocks. 
 * Adjust block range or indexing strategy for your production environment.
 */
export async function hasTransferred5USDT(userAddress: string): Promise<boolean> {
  const provider = getProvider();
  const currentBlock = await provider.getBlockNumber();
  const startBlock = currentBlock - 200000;
  if (startBlock < 0) return false;

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
    const parsed = getUsdtToken().interface.parseLog(log);
    if (!parsed) continue;
    const value = parsed.args.value as bigint;
    if (value >= ethers.parseUnits("5", 18)) return true;
  }
  return false;
}

/**
 * Mints MiniPoints to the user from the owner wallet.
 */
export async function mintMiniPoints(userAddress: string, amount: bigint) {
  const tx = await getMiniPoints().mint(userAddress, amount);
  console.log(`Minting ${amount} points to ${userAddress}, txHash = ${tx.hash}`);
  await tx.wait();
  console.log("Mint confirmed");
}
