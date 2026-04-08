// lib/clawTypes.ts
// Shared types, enums, and constants for the Akiba Claw game.

// ── Contracts ──────────────────────────────────────────────────────────────

export const CLAW_GAME_ADDRESS = (
  process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
  "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3"
) as `0x${string}`;

export const BATCH_RNG_ADDRESS = (
  process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
  "0x249Ce901411809a8A0fECa6102D9F439bbf3751e"
) as `0x${string}`;

export const VOUCHER_REGISTRY_ADDRESS = (
  process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ??
  "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC"
) as `0x${string}`;

export const CLAW_USDT_ADDRESS = (
  process.env.NEXT_PUBLIC_CLAW_USDT_ADDRESS ??
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
) as `0x${string}`;

export const MILES_ADDRESS = (
  process.env.NEXT_PUBLIC_MINIPOINTS_V2_ADDRESS ??
  "0xab93400000751fc17918940C202A66066885d628"
) as `0x${string}`;

export const CLAW_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "61599859"
);

export const AKIBA_TOKEN_SYMBOL = "AkibaMiles";

// ── Enums (mirror Solidity) ────────────────────────────────────────────────

export enum RewardClass {
  None = 0,
  Lose = 1,
  Common = 2,
  Rare = 3,
  Epic = 4,
  Legendary = 5,
}

export enum SessionStatus {
  None = 0,
  Pending = 1,
  Settled = 2,
  Claimed = 3,
  Burned = 4,
  Refunded = 5,
}

// ── Types ──────────────────────────────────────────────────────────────────

export type TierConfig = {
  active: boolean;
  tierId: number;
  payInMiles: boolean;
  playCost: bigint;
  loseWeight: number;
  commonWeight: number;
  rareWeight: number;
  epicWeight: number;
  legendaryWeight: number;
  commonMilesReward: bigint;
  rareBurnMiles: bigint;
  epicUsdtReward: bigint;
  legendaryBurnUsdt: bigint;
  rareVoucherBps: number;
  legendaryVoucherBps: number;
  legendaryVoucherCap: bigint;
  dailyPlayLimit: bigint;
  legendaryCooldown: bigint;
  defaultMerchantId: `0x${string}`;
};

export type GameSession = {
  sessionId: bigint;
  player: `0x${string}`;
  tierId: number;
  status: SessionStatus;
  createdAt: bigint;
  settledAt: bigint;
  requestBlock: bigint;
  rewardClass: RewardClass;
  rewardAmount: bigint;
  voucherId: bigint;
};

export type ClawVoucher = {
  voucherId: bigint;
  owner: `0x${string}`;
  tierId: number;
  rewardClass: RewardClass;
  discountBps: number;
  maxValue: bigint;
  expiresAt: bigint;
  redeemed: boolean;
  burned: boolean;
  merchantId: `0x${string}`;
  // derived
  voucherStatus: "active" | "redeemed" | "expired" | "burned";
};

// Machine animation state
export type MachineState =
  | "idle"
  | "starting"
  | "pending"
  | "ready"
  | "settling"
  | "settled";

// ── Tier display meta ──────────────────────────────────────────────────────

export const TIER_META: Record<number, { name: string; accent: string; bg: string }> = {
  0: { name: "Basic",   accent: "#238D9D", bg: "#EAF7F8" },
  1: { name: "Boosted", accent: "#2BA9B8", bg: "#E6F8FB" },
  2: { name: "Premium", accent: "#176B76", bg: "#DFF1F3" },
};

// ── Reward display meta ────────────────────────────────────────────────────

export const REWARD_META: Record<
  RewardClass,
  { label: string; color: string; emoji: string; description: string }
> = {
  [RewardClass.None]:      { label: "—",         color: "#9CA3AF", emoji: "❔", description: "" },
  [RewardClass.Lose]:      { label: "Miss",       color: "#9CA3AF", emoji: "💨", description: "Better luck next time!" },
  [RewardClass.Common]:    { label: AKIBA_TOKEN_SYMBOL, color: "#22C55E", emoji: "🪙", description: "AkibaMiles credited to your wallet." },
  [RewardClass.Rare]:      { label: "Voucher",    color: "#06B6D4", emoji: "🎟️", description: "20% merchant voucher. Burn for AkibaMiles fallback." },
  [RewardClass.Epic]:      { label: "USDT",       color: "#8B5CF6", emoji: "💎", description: "USDT paid directly to your wallet." },
  [RewardClass.Legendary]: { label: "Legendary",  color: "#F59E0B", emoji: "⭐", description: "Capped full-value voucher. Burn for USDT fallback." },
};
