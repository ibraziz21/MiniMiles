import express from "express";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// 1) Load environment variables
const CELO_RPC_URL = process.env.CELO_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const MINIPOINTS_ADDRESS = process.env.MINIPOINTS_ADDRESS || "";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "";

// 2) Setup provider & wallet
const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// 3) MiniPoints ABI (simplified)
const MINIPOINTS_ABI = [
  "function mint(address account, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)"
];

// 4) USDT (or any ERC20) ABI (simplified for transfer logs)
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address account) view returns (uint256)"
];

// 5) Contract instances
const miniPoints = new ethers.Contract(MINIPOINTS_ADDRESS, MINIPOINTS_ABI, wallet);
const usdtToken = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);

// A simple in-memory store to track if user already claimed a quest
// (In production, store in a database).
const userClaims: Record<string, boolean> = {};

// ----------------------------------
// HELPER FUNCTIONS
// ----------------------------------

/**
 * Checks if user has done >=25 outgoing transactions on Celo.
 */
async function has25Transactions(userAddress: string): Promise<boolean> {
  // Check the user's nonce => number of outgoing transactions
  const txCount = await provider.getTransactionCount(userAddress);
  return txCount >= 25;
}

/**
 * Checks if user has done at least one 5 USDT transfer from their address.
 * In a real app, you'd likely parse logs or track a block range.
 */
async function hasTransferred5USDT(userAddress: string): Promise<boolean> {
  // We do a simple "balance" check or event log check. For demonstration,
  // let's query the Transfer logs for userAddress as the 'from' for at least a 5 USDT transfer
  // This can be expensive for large block ranges. A real solution might index logs off-chain.
  
  const currentBlock = await provider.getBlockNumber();
  const startBlock = currentBlock - 200000; // some range. Adjust as needed.

  // Filter Transfer events from userAddress
  const filter = {
    address: USDT_ADDRESS,
    fromBlock: startBlock,
    toBlock: currentBlock,
    topics: [
      ethers.id("Transfer(address,address,uint256)"),
      ethers.zeroPadBytes(userAddress, 32) // 'from'
    ]
  };

  const logs = await provider.getLogs(filter);
  // logs of Transfer events where 'from' = userAddress
  // each log.data => 0x... with the transferred amount

  for (const log of logs) {
    // decode the data
    const parsed = usdtToken.interface.parseLog(log);
    // parsed.args => [from, to, value]
    if(parsed != undefined){

    const value = parsed.args.value as bigint;
    // If at least 5 * 10^decimals (assuming 18 decimals?), check if value >= 5 * 1e18
    // For demonstration, let's assume 18 decimals. Adjust if your USDT is 6 decimals, etc.
    if (value >= ethers.parseUnits("5", 18)) {
      return true; 
    }
}
  }
  return false;
}

/**
 * Mint the user some MiniPoints.
 */
async function mintMiniPoints(userAddress: string, amount: bigint) {
  const tx = await miniPoints.mint(userAddress, amount);
  console.log(`Minting ${amount} points to ${userAddress}, txHash = ${tx.hash}`);
  await tx.wait();
  console.log(`Minted confirmed.`);
}

// ----------------------------------
// ROUTES
// ----------------------------------

/**
 * POST /claim
 * Body: { userAddress: string, questId: string }
 * 
 * questId can be "25tx" or "transfer5usdt"
 */
app.post("/claim", async (req, res) => {
  try {
    const { userAddress, questId } = req.body;
    if (!userAddress || !questId) {
      return res.status(400).json({ error: "Missing userAddress or questId" });
    }

    // 1) Check if user already claimed this quest
    //    (In a real system, store data in a DB keyed by user+quest).
    const key = `${userAddress}_${questId}`;
    if (userClaims[key]) {
      return res.status(400).json({ error: "Quest already claimed." });
    }

    // 2) Check quest conditions
    let eligible = false;
    if (questId === "25tx") {
      eligible = await has25Transactions(userAddress);
    } else if (questId === "transfer5usdt") {
      eligible = await hasTransferred5USDT(userAddress);
    } else {
      return res.status(400).json({ error: "Unknown questId" });
    }

    if (!eligible) {
      return res.status(400).json({ error: "User not eligible for this quest." });
    }

    // 3) If eligible, mint points 
    // For demonstration, let's award 20 points for "25tx", 30 for "transfer5usdt"
    let pointsToMint = 0n;
    if (questId === "25tx") {
      pointsToMint = 20n;
    } else if (questId === "transfer5usdt") {
      pointsToMint = 30n;
    }

    await mintMiniPoints(userAddress, pointsToMint);

    // 4) Mark quest as claimed
    userClaims[key] = true;

    // 5) Return success
    res.json({ success: true, message: "MiniPoints awarded!" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("Welcome to the MiniPoints quest backend!");
});

// ----------------------------------
// START THE SERVER
// ----------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
