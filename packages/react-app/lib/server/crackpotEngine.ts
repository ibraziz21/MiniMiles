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
  CRACKPOT_PEGS,
  NOISE_CLOSE_TO_MISS,
  NOISE_MISS_TO_CLOSE,
  NOISE_CLOSE_TO_MISS_USDT,
  NOISE_MISS_TO_CLOSE_USDT,
  ATTEMPT_DURATION_SECONDS,
  GUESS_COOLDOWN_SECONDS,
  SEED_MILES,
  POT_CAP_MILES,
  SEED_USDT,
  POT_CAP_USDT,
} from "@/lib/crackpotTypes";

// ── Code generation ───────────────────────────────────────────────

/**
 * Generate a cryptographically secure CRACKPOT_PEGS-symbol code (indices 0–5).
 * Mixes CSPRNG bytes with an external entropy source (e.g. BTC block hash)
 * so the output is unpredictable even if the CSPRNG seed leaks.
 */
export function generateCode(entropySource: string): number[] {
  const rngBytes = randomBytes(32);
  const combined = createHash("sha256")
    .update(rngBytes)
    .update(entropySource)
    .digest();

  return Array.from({ length: CRACKPOT_PEGS }, (_, i) => combined[i] % 6);
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
 *     secretCode,                // bytesN  (CRACKPOT_PEGS × 1-byte symbol index)
 *   ))
 *
 * The contract only ever stores/compares the resulting bytes32 hash — it has
 * no opinion on the preimage shape, so the peg count can change here without
 * any contract redeploy.
 *
 * @param chainId           e.g. 42220 (Celo)
 * @param contractAddress   CrackPot proxy address (checksummed or lowercase)
 * @param contractVersion   0 (MILES) or 1 (USDT)
 * @param expiresAt         Cycle expiry as a Date
 * @param secretSalt        64-char hex string (32 bytes, no 0x prefix)
 * @param secretCode        CRACKPOT_PEGS symbol indices 0–5
 */
export function computeSecretCommitment(params: {
  chainId:          number;
  contractAddress:  Hex;
  contractVersion:  number;
  expiresAt:        Date;
  secretSalt:       string;   // 64-char hex, no 0x prefix
  secretCode:       number[];
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

  // Encode the symbol indices as a packed bytesN (one byte per symbol).
  const codeHex = secretCode
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("") as Hex;
  const bytesType = `bytes${secretCode.length}` as "bytes5";

  return keccak256(
    encodePacked(
      ["string",  "uint256",         "address",        "uint8",           "uint64",       "bytes32",              bytesType],
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
  secret: number[],
  guess: number[],
): GuessFeedback {
  const n = secret.length;
  const feedback: FeedbackResult[] = new Array(n).fill("miss");
  const secretUsed = new Array(n).fill(false);
  const guessUsed = new Array(n).fill(false);

  // Pass 1: locked positions
  for (let i = 0; i < n; i++) {
    if (guess[i] === secret[i]) {
      feedback[i] = "locked";
      secretUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  // Pass 2: close positions
  for (let i = 0; i < n; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < n; j++) {
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
 * Noise scales down as the player gets closer to the solution, based on how
 * many positions remain unlocked (pegs - lockedCount):
 *   - >=4 remaining: full noise (anti-solver protection)
 *   - 3 remaining:   75% of base noise
 *   - 2 remaining:   40% of base noise
 *   - <=1 remaining: 0% noise (endgame must be solvable by deduction)
 *
 * Deterministic per (cycleId, playerAddress, guessNumber, position)
 * so the same player always sees the same result on refresh.
 *
 * `closeToMiss`/`missToClose` let callers dial noise intensity per version —
 * see `applyNoiseForVersion`.
 */
export function applyNoise(
  feedback: GuessFeedback,
  cycleId: string,
  playerAddress: string,
  guessNumber: number,
  closeToMiss: number = NOISE_CLOSE_TO_MISS,
  missToClose: number = NOISE_MISS_TO_CLOSE,
): GuessFeedback {
  const lockedCount = feedback.filter((f) => f === "locked").length;
  const remaining = feedback.length - lockedCount;

  const scale = remaining <= 1 ? 0 : remaining === 2 ? 0.4 : remaining === 3 ? 0.75 : 1.0;

  if (scale === 0) return feedback;

  return feedback.map((result, position) => {
    if (result === "locked") return "locked";

    const seed = createHash("sha256")
      .update(`${cycleId}:${playerAddress.toLowerCase()}:${guessNumber}:${position}`)
      .digest();
    const rand = seed[0] / 255;

    if (result === "close" && rand < closeToMiss * scale) return "miss";
    if (result === "miss" && rand < missToClose * scale) return "close";
    return result;
  }) as GuessFeedback;
}

/**
 * Version-aware noise gate:
 *   MILES / base_miles  — full noise (anti-solver, lower stakes).
 *   USDT  / base_usdc   — light noise (real money, but unlimited-retry +
 *                         truthful feedback makes the code solvable for
 *                         pennies against a much larger pot — see
 *                         NOISE_*_USDT for the tuned rates).
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
  const closeToMiss = isMiles ? NOISE_CLOSE_TO_MISS : NOISE_CLOSE_TO_MISS_USDT;
  const missToClose = isMiles ? NOISE_MISS_TO_CLOSE : NOISE_MISS_TO_CLOSE_USDT;
  return applyNoise(feedback, cycleId, playerAddress, guessNumber, closeToMiss, missToClose);
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
