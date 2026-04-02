// lib/diceTypes.ts

// ── Tier type system ─────────────────────────────────────────────

export const MILES_TIERS = [10, 20, 30] as const;
export type MilesTier = (typeof MILES_TIERS)[number];

/** USD tier IDs: 250 = $0.25, 500 = $0.50, 1000 = $1.00 */
export const USD_TIERS = [250, 500, 1000] as const;
export type UsdTier = (typeof USD_TIERS)[number];

export type DiceTier = MilesTier | UsdTier;
export type DiceMode = "akiba" | "usd";

/** Legacy alias – kept for existing code that imports TIERS */
export const TIERS = MILES_TIERS;

// ── USD tier display metadata ────────────────────────────────────

export type UsdTierMeta = {
  entry: number;   // USD dollars (e.g. 0.25)
  payout: number;  // USD dollars winner receives (e.g. 1.00)
  miles: number;   // AkibaMiles winner receives (e.g. 100)
  label: string;
};

export const USD_TIER_META: Record<UsdTier, UsdTierMeta> = {
  250:  { entry: 0.25, payout: 1.00, miles: 100, label: "Starter"  },
  500:  { entry: 0.50, payout: 2.00, miles: 200, label: "Standard" },
  1000: { entry: 1.00, payout: 3.00, miles: 300, label: "Premium"  },
};

/** USDT bonus awarded to the winner of specific Miles tiers (in USD). */
export const MILES_TIER_BONUS_USD: Partial<Record<MilesTier, number>> = {
  30: 0.10,
};

// ── Round types ──────────────────────────────────────────────────

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
  /** True when this round uses USDT entry instead of AkibaMiles */
  isUsdTier: boolean;
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

// ── Helpers ──────────────────────────────────────────────────────

export function shortAddress(addr: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Format a 6-decimal USDT bigint as a dollar string, e.g. 1_500_000n → "$1.50" */
export function formatUsdt(raw: bigint | null | undefined): string {
  if (!raw && raw !== 0n) return "$0.00";
  return `$${(Number(raw) / 1_000_000).toFixed(2)}`;
}

/** Format an 18-decimal AkibaMiles bigint as a plain number string */
export function formatMiles(raw: bigint | null | undefined): string {
  if (!raw && raw !== 0n) return "0";
  const ONE_E18 = 1_000_000_000_000_000_000n;
  if (raw >= ONE_E18) return (Number(raw / ONE_E18)).toLocaleString();
  return Number(raw).toLocaleString();
}

export function isMilesTier(tier: DiceTier): tier is MilesTier {
  return (MILES_TIERS as readonly number[]).includes(tier);
}

export function isUsdTierType(tier: DiceTier): tier is UsdTier {
  return (USD_TIERS as readonly number[]).includes(tier);
}

/** Human-readable pot value string for a given tier and mode. */
export function tierPotLabel(tier: DiceTier): string {
  if (isUsdTierType(tier)) {
    const meta = USD_TIER_META[tier];
    return `$${meta.payout.toFixed(2)} + ${meta.miles} Miles`;
  }
  const bonus = MILES_TIER_BONUS_USD[tier as MilesTier];
  const base = `${(tier * 6).toLocaleString()} Miles`;
  return bonus ? `${base} + $${bonus.toFixed(2)}` : base;
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
