// lib/diceTypes.ts
export const TIERS = [10, 20, 30] as const;
export type DiceTier = (typeof TIERS)[number];

export type DiceRoundStateName =
  | "none"
  | "open"
  | "fullWaiting"
  | "ready"
  | "resolved";

export type DiceSlot = {
  number: number;
  player: `0x${string}` | null;
};

export type DiceRoundView = {
  tier: number;
  roundId: bigint;
  filledSlots: number;
  winnerSelected: boolean;
  winningNumber: number | null;
  randomBlock: bigint;
  winner: `0x${string}` | null;
  slots: DiceSlot[];
  myNumber: number | null;
  state: DiceRoundStateName;
};

export type TierStats = {
  roundsCreated: number;
  roundsResolved: number;
  totalStaked: bigint;
  totalPayout: bigint;
} | null;

export type PlayerStats = {
  roundsJoined: number;
  roundsWon: number;
  totalStaked: bigint;
  totalWon: bigint;
} | null;

export function shortAddress(addr: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function stateLabel(state: DiceRoundStateName) {
  switch (state) {
    case "open":
      return "Waiting for players";
    case "fullWaiting":
      return "Pot full – randomness pending";
    case "ready":
      return "Randomness ready – drawing";
    case "resolved":
      return "Last round resolved";
    default:
      return "New pot";
  }
}

export function statePillClasses(state: DiceRoundStateName) {
  switch (state) {
    case "open":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "fullWaiting":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "ready":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "resolved":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}
