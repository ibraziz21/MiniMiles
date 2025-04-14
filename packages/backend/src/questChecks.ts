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
