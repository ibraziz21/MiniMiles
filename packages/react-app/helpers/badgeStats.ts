// src/helpers/badgeStats.ts
import { gql, request } from "graphql-request";
import { createClient } from "@supabase/supabase-js";

/* ───────────────────────── config ───────────────────────── */

const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/115307/akiba-v-2/version/latest"; // same as history

const AKIBA_DECIMALS = 18;

/** Cost in AkibaMiles to claim the pass badge */
export const PASS_BADGE_FEE = 100;

/** Lifetime AkibaMiles thresholds (total) */
const LIFETIME_BADGE_THRESHOLDS = [250, 1000, 5000, 20000, 100000];

/** Lifetime AkibaMiles thresholds (from games only) */
const GAME_LIFETIME_BADGE_THRESHOLDS = [100, 1000, 10000];

/**
 * Game quest IDs in Supabase `daily_engagements` that should count as
 * "Miles earned from games".
 *
 * 👉 TODO: update with your actual quest IDs (dice, coinflip, etc.).
 */
const GAME_QUEST_IDS = [
  "dice_daily",
  "dice_win",
  "coinflip_play",
  "coinflip_win",
  "games_streak",
];

/* ──────────────────────── Supabase ─────────────────────── */

const {
  SUPABASE_URL = "",
  SUPABASE_SERVICE_KEY = "",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn("[badgeStats] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/* ────────────────────── Types & helpers ─────────────────── */

export type BadgeKind = "PASS" | "LIFETIME" | "GAME_LIFETIME";

export interface Badge {
  id: string;
  kind: BadgeKind;
  label: string;
  threshold: number;
  /** amount towards threshold (e.g. lifetimeEarned or lifetimeFromGames) */
  progress: number;
  /** true if progress >= threshold */
  unlocked: boolean;
  /**
   * Whether the user has already claimed the badge.
   * 👉 Currently always false – wire to your own table later.
   */
  claimed: boolean;
  /** Optional: cost in Miles to claim (for pass badge) */
  cost?: number;
}

/* GraphQL query: all mints (zero → user) */
const LIFETIME_MINTS_QUERY = gql`
  query LifetimeEarned($user: Bytes!) {
    mints: transfers(
      where: {
        to:   $user
        from: "0x0000000000000000000000000000000000000000"
      }
    ) {
      value
    }
  }
`;

/* ───────────────────── lifetime from subgraph ───────────── */

/**
 * Sum of all AkibaMiles ever minted to this user (from zero address).
 * This matches how history builds the EARN rows.
 */
export async function getLifetimeEarnedMiles(address: string): Promise<number> {
  const key = address.toLowerCase();

  const res = await request<{ mints: { value: string }[] }>(
    SUBGRAPH_URL,
    LIFETIME_MINTS_QUERY,
    { user: key }
  );

  const mints = Array.isArray(res.mints) ? res.mints : [];

  const total = mints.reduce((sum, m) => {
    const raw = BigInt(m.value ?? "0");
    return sum + Number(raw) / 10 ** AKIBA_DECIMALS;
  }, 0);

  return total;
}

/* ───────────── lifetime from games (Supabase daily_engagements) ────────── */

/**
 * Lifetime AkibaMiles earned from *game-related* quests, based on Supabase
 * `daily_engagements` table.
 *
 * We assume:
 *  - table: daily_engagements
 *  - columns: user_address (string), quest_id (string), points_awarded (number)
 *
 * 👉 Update GAME_QUEST_IDS to reflect real quest IDs for your games.
 */
export async function getLifetimeEarnedMilesFromGames(
  address: string
): Promise<number> {
  const key = address.toLowerCase();

  const { data, error } = await supabase
    .from("daily_engagements")
    .select("quest_id, points_awarded")
    .eq("user_address", key)
    .in("quest_id", GAME_QUEST_IDS);

  if (error) {
    console.error("[getLifetimeEarnedMilesFromGames] Supabase error", error);
    return 0;
  }

  if (!Array.isArray(data)) return 0;

  return data.reduce((sum, row) => sum + (row.points_awarded ?? 0), 0);
}

/* ────────────────────── badge builder ───────────────────── */

function buildLifetimeBadges(lifetimeEarned: number): Badge[] {
  return LIFETIME_BADGE_THRESHOLDS.map((thr) => ({
    id: `lifetime_${thr}`,
    kind: "LIFETIME" as const,
    label: `Lifetime ${thr.toLocaleString()} Miles`,
    threshold: thr,
    progress: lifetimeEarned,
    unlocked: lifetimeEarned >= thr,
    claimed: false, // TODO: wire to your "claimed badges" table
  }));
}

function buildGameLifetimeBadges(lifetimeFromGames: number): Badge[] {
  return GAME_LIFETIME_BADGE_THRESHOLDS.map((thr) => ({
    id: `game_lifetime_${thr}`,
    kind: "GAME_LIFETIME" as const,
    label: `Lifetime ${thr.toLocaleString()} Miles from Games`,
    threshold: thr,
    progress: lifetimeFromGames,
    unlocked: lifetimeFromGames >= thr,
    claimed: false, // TODO: wire to your "claimed badges" table
  }));
}

function buildPassBadge(lifetimeEarned: number): Badge {
  // For now: unlock when user has ≥ 100 Miles lifetime.
  // You can change this to any condition you like.
  const unlocked = lifetimeEarned >= PASS_BADGE_FEE;

  return {
    id: "pass_badge",
    kind: "PASS",
    label: "Akiba Pass",
    threshold: PASS_BADGE_FEE,
    progress: lifetimeEarned,
    unlocked,
    claimed: false, // TODO: read from a badges_claimed table
    cost: PASS_BADGE_FEE,
  };
}

/* ────────────────────── main entrypoint ─────────────────── */

export interface BadgeProgressPayload {
  address: string;
  lifetimeEarned: number;
  lifetimeFromGames: number;
  passBadge: Badge;
  lifetimeBadges: Badge[];
  gameBadges: Badge[];
}

export async function getBadgeProgress(
  address: string
): Promise<BadgeProgressPayload> {
  const [lifetimeEarned, lifetimeFromGames] = await Promise.all([
    getLifetimeEarnedMiles(address),
    getLifetimeEarnedMilesFromGames(address),
  ]);

  const passBadge = buildPassBadge(lifetimeEarned);
  const lifetimeBadges = buildLifetimeBadges(lifetimeEarned);
  const gameBadges = buildGameLifetimeBadges(lifetimeFromGames);

  return {
    address: address.toLowerCase(),
    lifetimeEarned,
    lifetimeFromGames,
    passBadge,
    lifetimeBadges,
    gameBadges,
  };
}
