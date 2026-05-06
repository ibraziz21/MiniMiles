import type { Abi } from "viem";

export const AKIBA_SKILL_GAMES_ADDRESS = process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS as
  | `0x${string}`
  | undefined;

export const akibaSkillGamesAbi = [
  // ── write ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "startGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameType",       type: "uint8"   },
      { name: "seedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "sessionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "startGameFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player",          type: "address" },
      { name: "gameType",        type: "uint8"   },
      { name: "seedCommitment",  type: "bytes32" },
      { name: "nonce",           type: "uint256" },
      { name: "expiry",          type: "uint256" },
      { name: "playerSignature", type: "bytes"   },
    ],
    outputs: [{ name: "sessionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "buyCredits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameType", type: "uint8"   },
      { name: "count",    type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId",    type: "uint256" },
      { name: "score",        type: "uint256" },
      { name: "rewardMiles",  type: "uint256" },
      { name: "rewardStable", type: "uint256" },
      { name: "expiry",       type: "uint256" },
      { name: "signature",    type: "bytes"   },
    ],
    outputs: [],
  },
  // ── view ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "gameConfigs",
    stateMutability: "view",
    inputs:  [{ name: "gameType", type: "uint8" }],
    outputs: [
      { name: "isEnabled",        type: "bool"    },
      { name: "entryCostMiles",   type: "uint256" },
      { name: "maxRewardMiles",   type: "uint256" },
      { name: "maxRewardStable",  type: "uint256" },
      { name: "settlementWindow", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "playerStatus",
    stateMutability: "view",
    inputs: [
      { name: "player",   type: "address" },
      { name: "gameType", type: "uint8"   },
    ],
    outputs: [
      { name: "credits",        type: "uint256" },
      { name: "playsToday",     type: "uint256" },
      { name: "playsRemaining", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "playCredits",
    stateMutability: "view",
    inputs: [
      { name: "player",   type: "address" },
      { name: "gameType", type: "uint8"   },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "startNonces",
    stateMutability: "view",
    inputs:  [{ name: "player", type: "address" }],
    outputs: [{ name: "",       type: "uint256" }],
  },
  {
    type: "function",
    name: "currentDay",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_DAILY_PLAYS",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_CREDIT_BALANCE",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "address" }],
  },
  // ── events ─────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "GameStarted",
    inputs: [
      { name: "sessionId",      type: "uint256", indexed: true  },
      { name: "player",         type: "address", indexed: true  },
      { name: "gameType",       type: "uint8",   indexed: true  },
      { name: "entryCost",      type: "uint256", indexed: false },
      { name: "seedCommitment", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GameSettled",
    inputs: [
      { name: "sessionId",   type: "uint256", indexed: true  },
      { name: "player",      type: "address", indexed: true  },
      { name: "gameType",    type: "uint8",   indexed: true  },
      { name: "score",       type: "uint256", indexed: false },
      { name: "rewardMiles", type: "uint256", indexed: false },
      { name: "rewardStable",type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CreditsPurchased",
    inputs: [
      { name: "player",    type: "address", indexed: true  },
      { name: "gameType",  type: "uint8",   indexed: true  },
      { name: "count",     type: "uint256", indexed: false },
      { name: "totalCost", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CreditConsumed",
    inputs: [
      { name: "player",    type: "address", indexed: true  },
      { name: "gameType",  type: "uint8",   indexed: true  },
      { name: "remaining", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SponsoredStartUsed",
    inputs: [
      { name: "player",    type: "address", indexed: true },
      { name: "gameType",  type: "uint8",   indexed: true },
      { name: "sessionId", type: "uint256", indexed: true },
    ],
  },
] as const satisfies Abi;

// ── intent signing helpers ──────────────────────────────────────────────────

export const START_INTENT_TYPEHASH_PREIMAGE =
  "AkibaStartIntent(address player,uint8 gameType,bytes32 seedCommitment,uint256 nonce,uint256 expiry,address verifyingContract,uint256 chainId)";

export const SETTLEMENT_TYPEHASH_PREIMAGE =
  "AkibaSkillGameSettlement(uint256 sessionId,address player,uint8 gameType,uint256 score,uint256 rewardMiles,uint256 rewardStable,uint256 expiry,address verifyingContract,uint256 chainId)";
