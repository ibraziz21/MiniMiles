"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.miniPoints = void 0;
exports.has25Transactions = has25Transactions;
exports.hasTransferred5USDT = hasTransferred5USDT;
exports.mintMiniPoints = mintMiniPoints;
// src/questChecks.ts
const ethers_1 = require("ethers");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const CELO_RPC_URL = process.env.CELO_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const MINIPOINTS_ADDRESS = process.env.MINIPOINTS_ADDRESS || "";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "";
const provider = new ethers_1.ethers.JsonRpcProvider(CELO_RPC_URL);
const wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, provider);
// Minimal ABI for your MiniPoints
const MINIPOINTS_ABI = [
    "function mint(address account, uint256 amount) external",
    "function balanceOf(address account) view returns (uint256)"
];
// Minimal ERC20 ABI
const ERC20_ABI = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];
exports.miniPoints = new ethers_1.ethers.Contract(MINIPOINTS_ADDRESS, MINIPOINTS_ABI, wallet);
const usdtToken = new ethers_1.ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
/**
 * Checks if user has 25 or more outgoing transactions.
 */
async function has25Transactions(userAddress) {
    const txCount = await provider.getTransactionCount(userAddress);
    return txCount >= 25;
}
/**
 * Checks if user has done at least one USDT transfer >= 5 tokens.
 * This naive approach queries logs for a range of blocks.
 * Adjust block range or indexing strategy for your production environment.
 */
async function hasTransferred5USDT(userAddress) {
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
            ethers_1.ethers.id("Transfer(address,address,uint256)"),
            ethers_1.ethers.zeroPadBytes(userAddress, 32)
        ]
    };
    const logs = await provider.getLogs(filter);
    for (const log of logs) {
        // parse the log
        const parsed = usdtToken.interface.parseLog(log);
        if (!parsed)
            continue;
        // Transfer event => [from, to, value]
        const value = parsed.args.value;
        // If >= 5 * 1e18 (assuming 18 decimals)
        if (value >= ethers_1.ethers.parseUnits("5", 18)) {
            return true;
        }
    }
    return false;
}
/**
 * Mints MiniPoints to the user from the owner wallet.
 */
async function mintMiniPoints(userAddress, amount) {
    const tx = await exports.miniPoints.mint(userAddress, amount);
    console.log(`Minting ${amount} points to ${userAddress}, txHash = ${tx.hash}`);
    await tx.wait();
    console.log("Mint confirmed");
}
