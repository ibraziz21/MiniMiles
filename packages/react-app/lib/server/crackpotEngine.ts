// lib/server/crackpotEngine.ts
// Core game logic — runs server-side only. Never imported by client components.

import { createHash, randomBytes } from "crypto";
import { keccak256, encodePacked, type Hex } from "viem";
import {
  type FeedbackResult,
  type GuessFeedback,
  type ThemeName,
  type CrackPotVersion,
  THEME_NAMES,
  NOISE_CLOSE_TO_MISS,
  NOISE_MISS_TO_CLOSE,
  ATTEMPT_DURATION_SECONDS,
  GUESS_COOLDOWN_SECONDS,
  SEED_MILES,
  POT_CAP_MILES,
  SEED_USDT,
  POT_CAP_USDT,
} from "@/lib/crackpotTypes";

// ── Code generation ───────────────────────────────────────────────

/**
 * Generate a cryptographically secure 4-symbol code (indices 0–5).
 * Mixes CSPRNG bytes with an external entropy source (e.g. BTC block hash)
 * so the output is unpredictable even if the CSPRNG seed leaks.
 */
export function generateCode(entropySource: string): [number, number, number, number] {
  const rngBytes = randomBytes(32);
  const combined = createHash("sha256")
    .update(rngBytes)
    .update(entropySource)
    .digest();

  return [
    combined[0] % 6,
    combined[1] % 6,
    combined[2] % 6,
    combined[3] % 6,
  ];
}

// ── Fairness commitment ───────────────────────────────────────────

export const COMMITMENT_ALGORITHM =
  'keccak256(abi.encodePacked("CRACKPOT_SECRET_V1", chainId, contractAddress, contractVersion, expiresAt, secretSalt, secretCode))';

/**
 * Compute the on-chain secretCommitment for a cycle.
 *
 * Mirrors the algorithm documented in CrackPot.sol and in CycleReveal so users
 * can independently verify:
 *
 *   keccak256(abi.encodePacked(
 *     "CRACKPOT_SECRET_V1",      // string  (UTF-8, no length prefix via encodePacked)
 *     chainId,                   // uint256
 *     contractAddress,           // address
 *     contractVersion,           // uint8   (0 = MILES, 1 = USDT)
 *     expiresAt,                 // uint64  (unix seconds)
 *     secretSalt,                // bytes32
 *     secretCode,                // bytes4  (4 × 1-byte symbol index)
 *   ))
 *
 * @param chainId           e.g. 42220 (Celo)
 * @param contractAddress   CrackPot proxy address (checksummed or lowercase)
 * @param contractVersion   0 (MILES) or 1 (USDT)
 * @param expiresAt         Cycle expiry as a Date
 * @param secretSalt        64-char hex string (32 bytes, no 0x prefix)
 * @param secretCode        Four symbol indices 0–5
 */
export function computeSecretCommitment(params: {
  chainId:          number;
  contractAddress:  Hex;
  contractVersion:  number;
  expiresAt:        Date;
  secretSalt:       string;   // 64-char hex, no 0x prefix
  secretCode:       [number, number, number, number];
}): Hex {
  const {
    chainId,
    contractAddress,
    contractVersion,
    expiresAt,
    secretSalt,
    secretCode,
  } = params;

  const expiresAtSec = BigInt(Math.floor(expiresAt.getTime() / 1000));

  // Encode the 4 symbol indices as a packed bytes4 (one byte per symbol).
  const codeHex = secretCode
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("") as Hex;

  return keccak256(
    encodePacked(
      ["string",  "uint256",         "address",        "uint8",           "uint64",       "bytes32",              "bytes4"],
      ["CRACKPOT_SECRET_V1", BigInt(chainId), contractAddress, contractVersion, expiresAtSec, `0x${secretSalt}` as Hex, `0x${codeHex}` as Hex],
    ),
  );
}

// ── Mastermind feedback ───────────────────────────────────────────

/**
 * Pure Mastermind feedback: exact LOCKED/CLOSE/MISS per position.
 * No noise applied here — noise is injected in applyNoise().
 */
export function computeFeedback(
  secret: [number, number, number, number],
  guess: [number, number, number, number],
): GuessFeedback {
  const feedback: FeedbackResult[] = ["miss", "miss", "miss", "miss"];
  const secretUsed = [false, false, false, false];
  const guessUsed = [false, false, false, false];

  // Pass 1: locked positions
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) {
      feedback[i] = "locked";
      secretUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  // Pass 2: close positions
  for (let i = 0; i < 4; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < 4; j++) {
      if (secretUsed[j]) continue;
      if (guess[i] === secret[j]) {
        feedback[i] = "close";
        secretUsed[j] = true;
        break;
      }
    }
  }

  return feedback as GuessFeedback;
}

// ── Noise injection ───────────────────────────────────────────────

/**
 * Inject noise into CLOSE/MISS feedback positions.
 * LOCKED is always truthful.
 *
 * Noise scales down as the player gets closer to the solution:
 *   - 0 locked: full noise (anti-AI protection)
 *   - 1 locked: 75% of base noise
 *   - 2 locked: 40% of base noise
 *   - 3 locked: 0% noise (endgame must be solvable by deduction)
 *
 * Deterministic per (cycleId, playerAddress, guessNumber, position)
 * so the same player always sees the same result on refresh.
 *
 * For USDT cycles, noise is NOT applied (truthful feedback for fairness).
 * Call `applyNoiseForVersion` which enforces this policy.
 */
export function applyNoise(
  feedback: GuessFeedback,
  cycleId: string,
  playerAddress: string,
  guessNumber: number,
): GuessFeedback {
  const lockedCount = feedback.filter((f) => f === "locked").length;

  // Scale factor: no noise at 3 locked, full noise at 0 locked
  const scale = lockedCount >= 3 ? 0 : lockedCount === 2 ? 0.4 : lockedCount === 1 ? 0.75 : 1.0;

  if (scale === 0) return feedback;

  return feedback.map((result, position) => {
    if (result === "locked") return "locked";

    const seed = createHash("sha256")
      .update(`${cycleId}:${playerAddress.toLowerCase()}:${guessNumber}:${position}`)
      .digest();
    const rand = seed[0] / 255;

    if (result === "close" && rand < NOISE_CLOSE_TO_MISS * scale) return "miss";
    if (result === "miss" && rand < NOISE_MISS_TO_CLOSE * scale) return "close";
    return result;
  }) as GuessFeedback;
}

/**
 * Version-aware noise gate:
 *   MILES / base_miles  — applies noise (anti-solver, lower stakes).
 *   USDT  / base_usdc   — truthful feedback, no noise.
 *
 * This is the function callers should use instead of applyNoise directly.
 */
export function applyNoiseForVersion(
  feedback: GuessFeedback,
  version: CrackPotVersion,
  cycleId: string,
  playerAddress: string,
  guessNumber: number,
): GuessFeedback {
  const isMiles = version === "miles" || version === "base_miles";
  if (!isMiles) return feedback; // USDT: truthful, no noise
  return applyNoise(feedback, cycleId, playerAddress, guessNumber);
}

// ── Cycle helpers ─────────────────────────────────────────────────

const MIN_FRESH_CYCLE_MS = 15 * 60 * 1000;

function ensureMinimumCycleLifetime(candidate: Date, intervalMs: number, now: Date): Date {
  if (candidate.getTime() - now.getTime() >= MIN_FRESH_CYCLE_MS) {
    return candidate;
  }
  return new Date(candidate.getTime() + intervalMs);
}

export function getCycleExpiresAt(version: CrackPotVersion): Date {
  const now = new Date();
  if (version === "miles" || version === "base_miles") {
    // Hourly cycles — expire at the top of the next hour (UTC)
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return ensureMinimumCycleLifetime(next, 60 * 60 * 1000, now);
  }
  // usdt / base_usdc: 12-hour cycles aligned to 00:00 / 12:00 EAT (UTC+3)
  const EAT_OFFSET = 3 * 60 * 60 * 1000;
  const eatNow = new Date(now.getTime() + EAT_OFFSET);
  const eatHour = eatNow.getUTCHours();
  const nextBoundary = eatHour < 12 ? 12 : 24;
  const eatMidnight = new Date(eatNow);
  eatMidnight.setUTCHours(0, 0, 0, 0);
  const next = new Date(eatMidnight.getTime() + nextBoundary * 3_600_000 - EAT_OFFSET);
  return ensureMinimumCycleLifetime(next, 12 * 60 * 60 * 1000, now);
}

export function getThemeForCycle(createdAt: Date): ThemeName {
  const dayIndex = Math.floor(createdAt.getTime() / 86_400_000);
  return THEME_NAMES[dayIndex % THEME_NAMES.length];
}

export function buildNewCycle(entropySource: string, version: CrackPotVersion = "miles") {
  const now = new Date();
  const theme = getThemeForCycle(now);
  const secret = generateCode(entropySource);
  const expiresAt = getCycleExpiresAt(version);

  const isMiles = version === "miles" || version === "base_miles";
  // Stable pot stored as integer cents (200 = $2.00, 5000 = $50.00)
  const seed = isMiles ? SEED_MILES : Math.round(SEED_USDT * 100);
  const cap  = isMiles ? POT_CAP_MILES : Math.round(POT_CAP_USDT * 100);

  return {
    version,
    theme,
    secret_code: secret,
    entropy_source: entropySource,
    status: "active" as const,
    pot_balance: seed,
    pot_cap: cap,
    seed_amount: seed,
    expires_at: expiresAt.toISOString(),
  };
}

// ── Attempt helpers ───────────────────────────────────────────────

export function buildAttemptExpiresAt(startedAt: Date = new Date()): Date {
  return new Date(startedAt.getTime() + ATTEMPT_DURATION_SECONDS * 1000);
}

export function isAttemptExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

export function isCooldownActive(lastGuessAt: string | null): boolean {
  if (!lastGuessAt) return false;
  const elapsed = (Date.now() - new Date(lastGuessAt).getTime()) / 1000;
  return elapsed < GUESS_COOLDOWN_SECONDS;
}

export function secondsUntil(isoTimestamp: string): number {
  return Math.max(0, Math.floor((new Date(isoTimestamp).getTime() - Date.now()) / 1000));
}
