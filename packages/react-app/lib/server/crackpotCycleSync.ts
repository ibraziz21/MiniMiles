// lib/server/crackpotCycleSync.ts
//
// Chain-first cycle sync.  Chain state is the authoritative source of truth.
//
// Two entry points:
//
//   getOrSyncActiveCycle(version)  — READ path (user requests).
//     Never sends transactions while the cron is on schedule. If the chain
//     cycle expired less than LAZY_ROTATION_GRACE_MS ago it throws
//     CycleRotatingError and lets the cron rotate; past the grace window (or
//     when no chain cycle exists at all) it self-heals by rotating under the
//     rotation lock.
//
//   rotateActiveCycle(version)     — ROTATE path (cron: /api/crackpot/cycle/expire).
//     Expires a stale chain cycle and opens the next one, serialized by the
//     crackpot_rotation_locks lease so exactly one worker sends transactions.
//
// Pending-row-first open protocol:
//   The secret preimage (code + salt + commitment + planned expiry) is
//   INSERTED as a status='pending' row BEFORE openCycle is sent on-chain.
//   After the tx confirms the row is promoted to 'active' with the
//   chain-assigned cycle id. If a worker dies between tx and promotion, any
//   other worker can match the on-chain secretCommitment to the pending row
//   and promote it — a chain cycle can no longer be stranded without its DB
//   preimage. A pending row whose openCycle never landed is reused on the
//   next rotation attempt (the commitment binds its expiry, so it is only
//   reused while that expiry is still comfortably in the future).
//
// Commitment:
//   keccak256(abi.encodePacked(
//     "CRACKPOT_SECRET_V1", chainId, contractAddress, contractVersion,
//     expiresAt (uint64), secretSalt (bytes32), secretCode (bytes4)
//   ))
//   Bound before the first entry is accepted; salt + code are revealed after
//   the cycle ends so anyone can recompute and verify.

import { randomBytes, randomUUID } from "crypto";
import { celo } from "viem/chains";
import type { Hex } from "viem";
import {
  ContractVersion,
  type ContractVersionType,
  type ContractCycle,
  contractGetActiveCycle,
  contractOpenCycle,
  contractExpireCycle,
} from "@/lib/server/crackpotContract";
import {
  rotationLockKey,
  acquireRotationLock,
  releaseRotationLock,
} from "@/lib/server/crackpotRotationLock";
import { supabase } from "@/lib/supabaseClient";
import {
  generateCode,
  getCycleExpiresAt,
  getThemeForCycle,
  computeSecretCommitment,
  COMMITMENT_ALGORITHM,
} from "@/lib/server/crackpotEngine";
import {
  SEED_MILES,
  POT_CAP_MILES,
  SEED_USDT,
  POT_CAP_USDT,
  type CrackPotCycle,
  type CrackPotVersion,
} from "@/lib/crackpotTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

const CELO_CHAIN_ID = celo.id; // 42220
const SYNC_RETRY_ATTEMPTS = process.env.NODE_ENV === "test" ? 2 : 8;
const SYNC_RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 5 : 750;

// How long after chain expiry the READ path defers to the cron before
// self-healing. The cron fires every minute, so a healthy deployment never
// reaches this.
const LAZY_ROTATION_GRACE_MS = 120_000;

// A pending row is only reused if its committed expiry is still at least this
// far away — otherwise it would open a cycle that immediately expires.
const PENDING_REUSE_MIN_MS = 5 * 60_000;

type PlayVersion = "miles" | "usdt";

type PendingRow = {
  id: string;
  expires_at: string;
  secret_commitment: string;
};

/** Thrown on the READ path while a rotation is in flight (or imminently due). */
export class CycleRotatingError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message = "CrackPot cycle is rotating") {
    super(message);
    this.name = "CycleRotatingError";
    this.retryAfterSeconds = 5;
  }
}

function crackpotAddr(chainId: number): Hex {
  if (chainId === 8453) {
    return (process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS ?? "") as Hex;
  }
  return (process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? "") as Hex;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contractVersionFor(version: PlayVersion): ContractVersionType {
  return version === "usdt" ? ContractVersion.USDT : ContractVersion.MILES;
}

function isChainCycleLive(cycle: ContractCycle, nowSec: number): boolean {
  return Number(cycle.expiresAt) > nowSec;
}

// ── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Convert an on-chain pot value to the integer stored in the DB.
 *   Miles  → chain is 18-dec bigint, DB stores whole Miles.
 *   USDT   → chain is 6-dec bigint (micro-USDT), DB stores integer cents.
 *             1 cent = 10_000 micro-USDT.
 */
export function chainPotToDb(raw: bigint, version: CrackPotVersion): number {
  if (version === "miles" || version === "base_miles") {
    return Number(raw / 10n ** 18n);
  }
  // usdt / base_usdc: micro-USDT → cents
  return Number(raw / 10_000n);
}

// ── Secret + commitment generation ───────────────────────────────────────────

/**
 * Generate a secret code with a keccak256 commitment that matches the on-chain
 * algorithm documented in CrackPot.sol.
 *
 * @param entropy          Entropy source string (e.g. current timestamp)
 * @param chainId          Chain ID (e.g. 42220)
 * @param contractVersion  0 (MILES) or 1 (USDT)
 * @param expiresAt        Planned cycle expiry (used in the commitment hash)
 * @param contractAddress  Proxy address on this chain
 */
export function generateSecretWithCommitment(
  entropy: string,
  chainId: number,
  contractVersion: ContractVersionType,
  expiresAt: Date,
  contractAddress: Hex,
): {
  secret:     [number, number, number, number];
  salt:       string;   // 64-char hex, no 0x prefix
  commitment: Hex;      // 0x-prefixed bytes32 keccak256
} {
  const secret = generateCode(entropy);
  const salt   = randomBytes(32).toString("hex");

  const commitment = computeSecretCommitment({
    chainId,
    contractAddress,
    contractVersion,
    expiresAt,
    secretSalt: salt,
    secretCode: secret,
  });

  return { secret, salt, commitment };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findDbRowByContractCycle(
  chainId: number,
  contractVersion: number,
  contractCycleId: number,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select("id, status")
    .eq("chain_id", chainId)
    .eq("contract_version", contractVersion)
    .eq("contract_cycle_id", contractCycleId)
    .maybeSingle();

  if (error) throw new Error(`[crackpotCycleSync] DB lookup failed: ${error.message}`);
  return data ?? null;
}

async function waitForDbRowByContractCycle(
  chainId: number,
  contractVersion: number,
  contractCycleId: number,
): Promise<{ id: string; status: string } | null> {
  for (let i = 0; i < SYNC_RETRY_ATTEMPTS; i++) {
    const row = await findDbRowByContractCycle(chainId, contractVersion, contractCycleId);
    if (row) return row;
    if (i < SYNC_RETRY_ATTEMPTS - 1) await delay(SYNC_RETRY_DELAY_MS);
  }
  return null;
}

async function findPendingRow(version: PlayVersion): Promise<PendingRow | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select("id, expires_at, secret_commitment")
    .eq("version", version)
    .eq("status", "pending")
    .maybeSingle();

  if (error) throw new Error(`[crackpotCycleSync] pending lookup failed: ${error.message}`);
  return (data as PendingRow | null) ?? null;
}

/**
 * Persist a fresh secret preimage as a 'pending' cycle row. Runs BEFORE the
 * openCycle transaction so the preimage can never be lost to a crash between
 * the tx and the DB write.
 */
async function insertPendingRow(
  version: PlayVersion,
  contractVersion: ContractVersionType,
  chainId: number,
): Promise<PendingRow> {
  const expiresAt    = getCycleExpiresAt(version);
  const contractAddr = crackpotAddr(chainId);
  const { secret, salt, commitment } = generateSecretWithCommitment(
    String(Date.now()),
    chainId,
    contractVersion,
    expiresAt,
    contractAddr,
  );

  const isMiles = version === "miles";
  const seed = isMiles ? SEED_MILES : Math.round(SEED_USDT * 100);
  const cap  = isMiles ? POT_CAP_MILES : Math.round(POT_CAP_USDT * 100);

  const { data, error } = await supabase
    .from("crackpot_cycles")
    .insert({
      version,
      theme:                getThemeForCycle(new Date()),
      secret_code:          secret,
      entropy_source:       "chain",
      status:               "pending",
      pot_balance:          seed,
      pot_cap:              cap,
      seed_amount:          seed,
      expires_at:           expiresAt.toISOString(),
      chain_id:             chainId,
      contract_version:     contractVersion,
      secret_salt:          salt,
      secret_commitment:    commitment,
      commitment_algorithm: COMMITMENT_ALGORITHM,
    })
    .select("id")
    .single();

  if (error) {
    // Unique violation → another worker inserted the pending row first; use it.
    if (error.code === "23505") {
      const existing = await findPendingRow(version);
      if (existing) return existing;
    }
    throw new Error(`[crackpotCycleSync] pending insert failed: ${error.message}`);
  }

  return {
    id:                data.id as string,
    expires_at:        expiresAt.toISOString(),
    secret_commitment: commitment,
  };
}

/**
 * Promote a pending row to the active cycle once the matching chain cycle is
 * confirmed. Values come from the chain (authoritative).
 */
async function promotePendingRow(
  pendingId: string,
  chainCycle: ContractCycle,
  version: PlayVersion,
  openTxHash: string | null,
): Promise<void> {
  const update: Record<string, unknown> = {
    status:            "active",
    contract_cycle_id: Number(chainCycle.id),
    pot_balance:       chainPotToDb(chainCycle.potBalance, version),
    pot_cap:           chainPotToDb(chainCycle.potCap,     version),
    seed_amount:       chainPotToDb(chainCycle.seedAmount, version),
    expires_at:        new Date(Number(chainCycle.expiresAt) * 1000).toISOString(),
  };
  if (openTxHash) update.open_tx_hash = openTxHash;

  const { error } = await supabase
    .from("crackpot_cycles")
    .update(update)
    .eq("id", pendingId)
    .eq("status", "pending");

  if (error) throw new Error(`[crackpotCycleSync] pending promote failed: ${error.message}`);
}

/** Retire a pending row that can no longer be opened (stale expiry / lost race). */
async function markPendingRowDead(pendingId: string): Promise<void> {
  const { error } = await supabase
    .from("crackpot_cycles")
    .update({ status: "dead" })
    .eq("id", pendingId)
    .eq("status", "pending");

  if (error) console.warn("[crackpotCycleSync] pending markDead failed:", error.message);
}

async function markDbRowDead(
  chainId: number,
  contractVersion: number,
  contractCycleId: number,
  expireTxHash: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("crackpot_cycles")
    .update({ status: "dead", expire_tx_hash: expireTxHash })
    .eq("chain_id", chainId)
    .eq("contract_version", contractVersion)
    .eq("contract_cycle_id", contractCycleId)
    .in("status", ["active", "settling"]);

  if (error) console.warn("[crackpotCycleSync] DB markDead failed:", error.message);
}

/**
 * Re-sync the DB pot_balance from the authoritative on-chain value.
 *
 * The pot grows on-chain with every recordEntry (Miles: full entry fee added;
 * USDT: the pot's share of the entry). The DB row is only seeded at cycle open,
 * so without this the pot would appear frozen at the seed amount. We update the
 * stored pot_balance whenever we read a live chain cycle.
 */
async function syncPotBalanceFromChain(
  rowId: string,
  chainCycle: ContractCycle,
  version: CrackPotVersion,
): Promise<void> {
  const potBalance = chainPotToDb(chainCycle.potBalance, version);
  const { error } = await supabase
    .from("crackpot_cycles")
    .update({ pot_balance: potBalance })
    .eq("id", rowId);

  if (error) console.warn("[crackpotCycleSync] pot_balance sync failed:", error.message);
}

async function fetchFullDbRow(rowId: string): Promise<CrackPotCycle> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select(
      "id, version, theme, status, pot_balance, pot_cap, seed_amount, " +
      "expires_at, winner_address, winner_guesses, winner_tx_hash, " +
      "payout_amount, cracked_at, commitment_algorithm, secret_revealed_at, " +
      "created_at, chain_id, contract_cycle_id, contract_version, secret_commitment",
      // Intentionally excludes: secret_code, secret_salt, open_tx_hash, expire_tx_hash
    )
    .eq("id", rowId)
    .single();

  if (error) throw new Error(`[crackpotCycleSync] DB row fetch failed: ${error.message}`);
  return data as unknown as CrackPotCycle;
}

// ── Chain wait helpers ────────────────────────────────────────────────────────

async function waitForActiveCycle(
  contractVersion: ContractVersionType,
  chainId: number,
): Promise<ContractCycle | null> {
  for (let i = 0; i < SYNC_RETRY_ATTEMPTS; i++) {
    const cycle = await contractGetActiveCycle(contractVersion, chainId);
    if (cycle) return cycle;
    if (i < SYNC_RETRY_ATTEMPTS - 1) await delay(SYNC_RETRY_DELAY_MS);
  }
  return null;
}

async function waitForCycleAfterExpire(
  contractVersion: ContractVersionType,
  chainId: number,
  staleCycleId: number,
  nowSec: number,
): Promise<ContractCycle | null> {
  for (let i = 0; i < SYNC_RETRY_ATTEMPTS; i++) {
    const cycle = await contractGetActiveCycle(contractVersion, chainId);
    if (!cycle) return null;

    const isSameExpiredCycle =
      Number(cycle.id) === staleCycleId &&
      Number(cycle.expiresAt) <= nowSec;

    if (!isSameExpiredCycle) return cycle;
    if (i < SYNC_RETRY_ATTEMPTS - 1) await delay(SYNC_RETRY_DELAY_MS);
  }

  return contractGetActiveCycle(contractVersion, chainId);
}

// ── Ensure DB row for a live chain cycle (read + recovery, no transactions) ──

async function ensureDbRowForChainCycle(
  chainCycle: ContractCycle,
  version: PlayVersion,
  chainId: number,
  contractVersion: ContractVersionType,
): Promise<CrackPotCycle> {
  const contractCycleId = Number(chainCycle.id);
  const existing = await findDbRowByContractCycle(chainId, contractVersion, contractCycleId);

  if (existing) {
    // Keep the stored pot in step with the live on-chain pot (grows per entry).
    await syncPotBalanceFromChain(existing.id, chainCycle, version);
    return fetchFullDbRow(existing.id);
  }

  // Recovery: a worker may have crashed after openCycle confirmed but before
  // promoting its pending row. The on-chain commitment identifies that row.
  const chainCommitment =
    typeof chainCycle.secretCommitment === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(chainCycle.secretCommitment)
      ? chainCycle.secretCommitment.toLowerCase()
      : null;

  if (chainCommitment) {
    const pending = await findPendingRow(version);
    if (pending && pending.secret_commitment?.toLowerCase() === chainCommitment) {
      await promotePendingRow(pending.id, chainCycle, version, null);
      return fetchFullDbRow(pending.id);
    }
  }

  // No preimage here. The contract only stores the commitment, so a server
  // that lacks the row cannot safely reconstruct the secret. Wait briefly in
  // case another worker is mid-promotion, then fail closed instead of
  // creating an unverifiable replacement secret.
  const eventual = await waitForDbRowByContractCycle(chainId, contractVersion, contractCycleId);
  if (eventual) return fetchFullDbRow(eventual.id);

  throw new Error("[crackpotCycleSync] active chain cycle has no DB preimage");
}

// ── Open a new chain cycle (pending-row-first) ────────────────────────────────

async function adoptChainCycle(
  chainCycle: ContractCycle,
  pending: PendingRow,
  openTxHash: string | null,
  version: PlayVersion,
  chainId: number,
  contractVersion: ContractVersionType,
): Promise<CrackPotCycle> {
  const contractCycleId = Number(chainCycle.id);

  const existing = await findDbRowByContractCycle(chainId, contractVersion, contractCycleId);
  if (existing) {
    if (existing.id !== pending.id) await markPendingRowDead(pending.id);
    await syncPotBalanceFromChain(existing.id, chainCycle, version);
    return fetchFullDbRow(existing.id);
  }

  const ours =
    typeof chainCycle.secretCommitment === "string" &&
    chainCycle.secretCommitment.toLowerCase() === pending.secret_commitment?.toLowerCase();

  if (ours) {
    await promotePendingRow(pending.id, chainCycle, version, openTxHash);
    return fetchFullDbRow(pending.id);
  }

  // The live chain cycle carries someone else's commitment — only that worker
  // holds the preimage. Retire our pending row and wait for theirs.
  await markPendingRowDead(pending.id);
  const eventual = await waitForDbRowByContractCycle(chainId, contractVersion, contractCycleId);
  if (eventual) return fetchFullDbRow(eventual.id);

  throw new Error(
    "[crackpotCycleSync] chain cycle opened by another worker has no DB preimage",
  );
}

async function openNewCycle(
  version: PlayVersion,
  contractVersion: ContractVersionType,
  chainId: number,
): Promise<CrackPotCycle> {
  // Reuse a pending row from a previous failed open when possible — its
  // commitment binds its expiry, so it is only viable while that expiry is
  // still comfortably in the future.
  let pending = await findPendingRow(version);
  if (pending) {
    const expiryMs = new Date(pending.expires_at ?? 0).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs < Date.now() + PENDING_REUSE_MIN_MS) {
      await markPendingRowDead(pending.id);
      pending = null;
    }
  }

  if (!pending) {
    pending = await insertPendingRow(version, contractVersion, chainId);
  }

  let openTxHash: string | null = null;
  let raceOpen = false;

  try {
    openTxHash = await contractOpenCycle(
      contractVersion,
      new Date(pending.expires_at),
      pending.secret_commitment as Hex,
      chainId,
    );
  } catch (err: any) {
    const msg = String(err?.shortMessage ?? err?.message ?? "").toLowerCase();
    if (msg.includes("already active") || msg.includes("cyclealreadyactive")) {
      raceOpen = true;
    } else {
      // openCycle failed — the pending row stays for reuse on the next
      // rotation attempt; no active cycle is ever created here.
      throw err;
    }
  }

  const chainCycle = await waitForActiveCycle(contractVersion, chainId);
  if (!chainCycle) {
    if (raceOpen) {
      throw new Error("[crackpotCycleSync] CycleAlreadyActive race but no active cycle found on-chain");
    }
    throw new Error("[crackpotCycleSync] openCycle reported success but no active cycle found on-chain");
  }

  return adoptChainCycle(chainCycle, pending, openTxHash, version, chainId, contractVersion);
}

// ── Rotation (transaction-sending; must hold the rotation lock) ──────────────

async function rotateLocked(
  version: PlayVersion,
  contractVersion: ContractVersionType,
  chainId: number,
): Promise<CrackPotCycle> {
  const nowSec = Math.floor(Date.now() / 1000);
  let chainCycle = await contractGetActiveCycle(contractVersion, chainId);

  // ── Expire a stale on-chain cycle ─────────────────────────────────────────
  if (chainCycle && Number(chainCycle.expiresAt) <= nowSec) {
    const staleId = Number(chainCycle.id);
    let expireTxHash: string | null = null;
    let expireResolved = false;
    let stillNotExpired = false;

    try {
      expireTxHash = await contractExpireCycle(contractVersion, chainId);
      expireResolved = true;
    } catch (err: any) {
      const msg = String(err?.shortMessage ?? err?.message ?? "").toLowerCase();
      const noActiveRace = msg.includes("no active cycle") ||
                           msg.includes("nocycleactive");
      stillNotExpired = msg.includes("cyclenotexpired") ||
                        msg.includes("not expired");

      if (noActiveRace) {
        expireResolved = true;
      } else if (!stillNotExpired) {
        throw err;
      }
    }

    if (expireResolved) {
      await markDbRowDead(chainId, contractVersion, staleId, expireTxHash);
      chainCycle = await waitForCycleAfterExpire(contractVersion, chainId, staleId, nowSec);

      if (
        chainCycle &&
        Number(chainCycle.id) === staleId &&
        Number(chainCycle.expiresAt) <= nowSec
      ) {
        throw new Error("[crackpotCycleSync] expired chain cycle still active after expireCycle");
      }
    } else if (stillNotExpired) {
      // Local clock can be ahead of chain time. Keep the chain cycle as active
      // and let the next cron tick expire it when the contract allows it.
      chainCycle = await contractGetActiveCycle(contractVersion, chainId);
    }
  }

  // ── Open the next cycle if none is active on-chain ────────────────────────
  if (!chainCycle) {
    return openNewCycle(version, contractVersion, chainId);
  }

  return ensureDbRowForChainCycle(chainCycle, version, chainId, contractVersion);
}

/**
 * Poll for another worker's rotation to finish (lock was unavailable).
 * Returns the fresh cycle once both chain and DB agree, or null on timeout.
 */
async function waitForRotationOutcome(
  version: PlayVersion,
  contractVersion: ContractVersionType,
  chainId: number,
): Promise<CrackPotCycle | null> {
  for (let i = 0; i < SYNC_RETRY_ATTEMPTS; i++) {
    const nowSec = Math.floor(Date.now() / 1000);
    const chainCycle = await contractGetActiveCycle(contractVersion, chainId);
    if (chainCycle && isChainCycleLive(chainCycle, nowSec)) {
      const row = await findDbRowByContractCycle(chainId, contractVersion, Number(chainCycle.id));
      if (row) return fetchFullDbRow(row.id);
    }
    if (i < SYNC_RETRY_ATTEMPTS - 1) await delay(SYNC_RETRY_DELAY_MS);
  }
  return null;
}

async function rotateWithLock(
  version: PlayVersion,
  chainId: number,
): Promise<CrackPotCycle> {
  const contractVersion = contractVersionFor(version);
  const lockKey  = rotationLockKey(chainId, contractVersion);
  const holderId = randomUUID();

  const acquired = await acquireRotationLock(lockKey, holderId);
  if (!acquired) {
    const settled = await waitForRotationOutcome(version, contractVersion, chainId);
    if (settled) return settled;
    throw new CycleRotatingError();
  }

  try {
    return await rotateLocked(version, contractVersion, chainId);
  } finally {
    await releaseRotationLock(lockKey, holderId);
  }
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * READ path — returns the current active (or settling) cycle for the given
 * version, synchronised with chain state. Never returns secret_code or
 * secret_salt.
 *
 * Sends no transactions while the rotation cron is on schedule; throws
 * CycleRotatingError during the post-expiry grace window and self-heals
 * (rotating under the lock) only past it or when no chain cycle exists.
 *
 * @param version    "miles" | "usdt"
 * @param chainId    Celo chain ID (default 42220)
 */
export async function getOrSyncActiveCycle(
  version: PlayVersion,
  chainId: number = CELO_CHAIN_ID,
): Promise<CrackPotCycle> {
  const contractVersion = contractVersionFor(version);
  const nowSec = Math.floor(Date.now() / 1000);

  const chainCycle = await contractGetActiveCycle(contractVersion, chainId);

  if (chainCycle && isChainCycleLive(chainCycle, nowSec)) {
    return ensureDbRowForChainCycle(chainCycle, version, chainId, contractVersion);
  }

  if (chainCycle) {
    const overdueMs = (nowSec - Number(chainCycle.expiresAt)) * 1000;
    if (overdueMs <= LAZY_ROTATION_GRACE_MS) {
      // The cron (every minute) owns this rotation; don't send transactions
      // from a user request.
      throw new CycleRotatingError();
    }
  }

  // No chain cycle at all, or expired well past the cron's grace window —
  // the cron is missing or down, so self-heal from user traffic.
  return rotateWithLock(version, chainId);
}

/**
 * ROTATE path — expires a stale chain cycle and opens the next one, under the
 * rotation lock. Called by the /api/crackpot/cycle/expire cron.
 */
export async function rotateActiveCycle(
  version: PlayVersion,
  chainId: number = CELO_CHAIN_ID,
): Promise<CrackPotCycle> {
  return rotateWithLock(version, chainId);
}
