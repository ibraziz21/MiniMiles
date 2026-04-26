import type { Abi } from "viem";

export const AKIBA_SKILL_GAMES_ADDRESS = process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS as
  | `0x${string}`
  | undefined;

export const akibaSkillGamesAbi = [
  {
    type: "function",
    name: "startGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gameType", type: "uint8" },
      { name: "seedCommitment", type: "bytes32" },
    ],
    outputs: [{ name: "sessionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "settleGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "score", type: "uint256" },
      { name: "rewardMiles", type: "uint256" },
      { name: "rewardStable", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "gameConfigs",
    stateMutability: "view",
    inputs: [{ name: "gameType", type: "uint8" }],
    outputs: [
      { name: "isEnabled", type: "bool" },
      { name: "entryCostMiles", type: "uint256" },
      { name: "maxRewardMiles", type: "uint256" },
      { name: "maxRewardStable", type: "uint256" },
      { name: "settlementWindow", type: "uint256" },
    ],
  },
] as const satisfies Abi;
