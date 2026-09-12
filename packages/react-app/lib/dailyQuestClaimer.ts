// lib/dailyQuestClaimer.ts
//
// Client-and-server-safe constants for the deployed Celo `DailyQuestClaimer`
// contract (see docs/daily-checkin-self-claim-spec.md §1). No secrets live
// here — the signing key stays in lib/server/dailyClaimSigner.ts, which this
// module must never import.
//
// This module now also holds the generic claim-nonce/scope helpers shared by
// every self-claim quest family, not just daily check-in
// (docs/all-quests-self-claim-spec.md §1-§2). The file keeps its name and the
// wire field stays `dayNonce` for ABI/EIP-712 compatibility with the deployed
// contract; new code should think of that value as a generic `claimNonce`.

import { encodeAbiParameters, keccak256, stringToHex } from "viem";

export const DAILY_QUEST_CLAIMER_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "dayNonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "dayNonce", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "milesToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "signer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "QuestClaimed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "dayNonce", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // Custom errors are best-effort: the spec's §1 ABI (read from the live
  // mainnet contract) lists only functions/events, not error signatures, and
  // neither source in this repo (the Base-oriented DailyQuestClaimer.sol vs.
  // a name reported during review) is confirmed to match the deployed Celo
  // bytecode's actual selectors. Listing multiple plausible names/shapes is
  // safe — an unmatched selector just fails to decode to a friendly name and
  // falls back to shortMessage — but re-verify these against the real
  // deployed contract per spec §9 before relying on them for UX copy.
  { type: "error", name: "Expired", inputs: [{ name: "deadline", type: "uint256" }] },
  { type: "error", name: "VoucherExpired", inputs: [{ name: "deadline", type: "uint256" }] },
  {
    type: "error",
    name: "AlreadyClaimed",
    inputs: [
      { name: "user", type: "address" },
      { name: "dayNonce", type: "uint256" },
    ],
  },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "Blacklisted", inputs: [] },
  { type: "error", name: "NullAddress", inputs: [] },
] as const;

export const CELO_CHAIN_ID = 42220;

/** EIP-712 typed-data types shared by signer and verifier. */
export const QUEST_CLAIM_EIP712_TYPES = {
  QuestClaim: [
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "dayNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function getDailyClaimDomain(contractAddress: `0x${string}`) {
  return {
    name: "DailyQuestClaimer",
    version: "1",
    chainId: CELO_CHAIN_ID,
    verifyingContract: contractAddress,
  } as const;
}

export type QuestClaimVoucher = {
  contractAddress: `0x${string}`;
  amount: string; // decimal uint256 string, 18-decimal units
  dayNonce: string; // decimal uint256 string
  deadline: string; // decimal unix-seconds string
  signature: `0x${string}`;
};

/** Freeze a points value into an 18-decimal wei amount using bigint math throughout. */
export function pointsToAmountWei(points: number): bigint {
  return BigInt(Math.trunc(points)) * 10n ** 18n;
}

/** floor(unixSeconds / 86400) — one nonce per UTC day. */
export function dayNonceForTimestamp(unixSeconds: number): bigint {
  return BigInt(Math.floor(unixSeconds / 86400));
}

/** Final second of the UTC day identified by dayNonce. */
export function deadlineForDayNonce(dayNonce: bigint): bigint {
  return (dayNonce + 1n) * 86400n - 1n;
}

export function claimDateForTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Resolves the UTC day context (claim date, day nonce, deadline) for "now".
 * Centralized so voucher issuance, confirmation and status all agree on the
 * cutover instant at midnight UTC.
 */
export function getUtcDayContext(now: Date = new Date()) {
  const unixSeconds = Math.floor(now.getTime() / 1000);
  const dayNonce = dayNonceForTimestamp(unixSeconds);
  return {
    claimDate: claimDateForTimestamp(unixSeconds),
    dayNonce,
    deadline: deadlineForDayNonce(dayNonce),
  };
}

// ── Generic claim nonce (all-quests-self-claim-spec.md §2) ────────────────────
//
// The deployed contract's `claim()` never checks that `dayNonce` equals the
// current UTC day — it only checks replay via claimed(wallet, dayNonce). That
// lets every other quest family reuse the same claimer without a new
// deployment, as long as its nonce can never collide with a legacy epoch-day
// nonce or with another quest's nonce for the same wallet. Setting the high
// bit gives an explicit namespace boundary; the unique (user_address,
// claim_nonce) database constraint is the second, storage-level guarantee.

export const GENERIC_CLAIM_NONCE_NAMESPACE = 1n << 255n;
const GENERIC_CLAIM_NONCE_DOMAIN_HASH = keccak256(stringToHex("AKIBA_QUEST_SELF_CLAIM_V1"));

/**
 * Deterministic nonce for any non-daily-check-in quest family. Never include
 * the reward amount — a reconfigured reward must not open a second replay
 * slot for a completion that already happened — and never accept `scopeKey`
 * from the client; it must always be server-resolved and normalized.
 */
export function computeGenericClaimNonce(questId: string, scopeKey: string): bigint {
  const digest = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }, { type: "string" }],
      [GENERIC_CLAIM_NONCE_DOMAIN_HASH, questId, scopeKey],
    ),
  );
  return BigInt(digest) | GENERIC_CLAIM_NONCE_NAMESPACE;
}

/** True for any nonce produced by computeGenericClaimNonce — i.e. not a legacy epoch-day nonce. */
export function isGenericClaimNonce(nonce: bigint): boolean {
  return (nonce & GENERIC_CLAIM_NONCE_NAMESPACE) !== 0n;
}

// ── UTC-safe scope helpers (all-quests-self-claim-spec.md §2, §3) ─────────────
// Every date/week calculation for the self-claim engine lives here, computed
// from UTC getters only — never local-time getters, which can shift the
// scope/deadline boundary by up to a day depending on server timezone.

export type ClaimScope = "daily" | "weekly" | "lifetime" | "instance";

/** UTC calendar date as YYYY-MM-DD. */
export function getUtcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO-8601 week (Monday-start, UTC) as YYYY-Www. */
export function getUtcIsoWeekKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Unix seconds for the final second of the UTC calendar date `dateKey` (YYYY-MM-DD). */
export function endOfUtcDateSeconds(dateKey: string): bigint {
  const startMs = Date.parse(`${dateKey}T00:00:00.000Z`);
  return BigInt(Math.floor(startMs / 1000)) + 86400n - 1n;
}

/** Unix seconds for the final second (Sunday 23:59:59 UTC) of ISO week `weekKey` (YYYY-Www). */
export function endOfUtcIsoWeekSeconds(weekKey: string): bigint {
  const [yearStr, weekStr] = weekKey.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  // ISO week 1 is the week containing the year's first Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4DayNum - 1) * 86_400_000);
  const mondayOfWeek = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  const sundayEndMs = mondayOfWeek.getTime() + 7 * 86_400_000 - 1000; // Sunday 23:59:59.000
  return BigInt(Math.floor(sundayEndMs / 1000));
}

/** Unix seconds `minutes` minutes from now — used for lifetime/instance voucher deadlines. */
export function minutesFromNowSeconds(minutes: number, now: Date = new Date()): bigint {
  return BigInt(Math.floor(now.getTime() / 1000)) + BigInt(minutes) * 60n;
}

/**
 * Deadline for a scope per docs/all-quests-self-claim-spec.md §3's table:
 * daily -> end of that UTC day, weekly -> end of that ISO week,
 * lifetime/instance -> 15 minutes after issue (refreshable while still open).
 */
export function deadlineForScope(scope: ClaimScope, scopeKey: string, now: Date = new Date()): bigint {
  if (scope === "daily") return endOfUtcDateSeconds(scopeKey);
  if (scope === "weekly") return endOfUtcIsoWeekSeconds(scopeKey);
  return minutesFromNowSeconds(15, now);
}

/**
 * The scope key immediately preceding `key`, for streak continuation checks
 * (all-quests-self-claim-spec.md §7 — the "streak_engagement" finalizer
 * needs this to decide whether a claim extends, resets, or repeats a streak).
 * Only meaningful for "daily"/"weekly" scope keys.
 */
export function previousScopeKeyFor(scope: "daily" | "weekly", key: string): string {
  if (scope === "daily") {
    const d = new Date(`${key}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);

  if (week > 1) {
    return `${year}-W${String(week - 1).padStart(2, "0")}`;
  }

  const lastDayPrevYear = new Date(Date.UTC(year - 1, 11, 31));
  return getUtcIsoWeekKey(lastDayPrevYear);
}
