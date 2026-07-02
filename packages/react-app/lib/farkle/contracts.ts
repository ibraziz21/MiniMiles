import type { Abi } from "viem";

export const FARKLE_TICKET_ADDRESS = process.env.NEXT_PUBLIC_FARKLE_TICKET_ADDRESS as
  | `0x${string}`
  | undefined;

export const DEFAULT_GAME_CREDIT_VAULT_ADDRESS = "0x31B4cbc6c3508156eCaFD937b36C5Bf68848bcba" as const;

export const GAME_CREDIT_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
  process.env.GAME_CREDIT_VAULT_ADDRESS ??
  DEFAULT_GAME_CREDIT_VAULT_ADDRESS) as
  | `0x${string}`
  | undefined;

/** USDT used for Reward Duel credit purchases (same token as the Claw game). */
export const FARKLE_USDT_ADDRESS = (process.env.NEXT_PUBLIC_FARKLE_USDT_ADDRESS ??
  process.env.NEXT_PUBLIC_CLAW_USDT_ADDRESS ??
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e") as `0x${string}`;

/** Minimal ERC-20 surface for USDT approve / allowance / balance. */
export const erc20Abi: Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

export const gameCreditVaultAbi: Abi = [
  {
    type: "function",
    name: "buyCredits",
    stateMutability: "nonpayable",
    inputs: [{ name: "packId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "creditPacks",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "packId", type: "uint256" },
      { name: "usdtAmount", type: "uint256" },
      { name: "creditAmount", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "gameCreditBalance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimRewardCredits",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "rewardCreditBalance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }], // USDT base units (6 dp)
  },
  {
    type: "function",
    name: "claimEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "CreditsPurchased",
    inputs: [
      { name: "user",         type: "address", indexed: true  },
      { name: "packId",       type: "uint256", indexed: true  },
      { name: "usdtAmount",   type: "uint256", indexed: false },
      { name: "creditAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RewardCreditsClaimed",
    inputs: [
      { name: "user",   type: "address", indexed: true  },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
];

export const farkleTicketAbi: Abi = [
  {
    type: "function",
    name: "buyTicketPack",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "ticketBalance",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketsPerPack",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "milesPerPack",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "TicketsPurchased",
    inputs: [
      { name: "user",         type: "address", indexed: true  },
      { name: "ticketAmount", type: "uint256", indexed: false },
      { name: "milesBurned",  type: "uint256", indexed: false },
    ],
  },
];
