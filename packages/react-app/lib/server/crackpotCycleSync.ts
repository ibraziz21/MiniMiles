// lib/server/crackpotCycleSync.ts
//
// Chain-first cycle sync.  Chain state is the authoritative source of truth.
//
// Flow:
//   1. Read active on-chain cycle.
//   2. If on-chain cycle is expired → expire on-chain, mark DB row dead.
//   3. If no active on-chain cycle → generate secret + commitment, open on-chain,
//      upsert DB.  CycleAlreadyActive race → re-read chain and upsert from that
//      cycle.
//   4. If active on-chain cycle but no DB row → repair (generate new secret + insert).
//   5. Return the DB cycle record (never exposes secret_code or secret_salt).
//
// Commitment:
//   We now pass a keccak256 precommitment to openCycle() on-chain.  The algorithm:
//     keccak256(abi.encodePacked(
//       "CRACKPOT_SECRET_V1", chainId, contractAddress, contractVersion,
//       expiresAt (uint64), secretSalt (bytes32), secretCode (bytes4)
//     ))
//   This binds the secret to this specific contract, version, and expiry window
//   before the first entry is accepted.  After the cycle ends the server reveals
//   secretSalt + secretCode so anyone can recompute and verify.

import { randomBytes } from "crypto";
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
import { supabase } from "@/lib/supabaseClient";
import {
  generateCode,
  getCycleExpiresAt,
  getThemeForCycle,
  computeSecretCommitment,
  COMMITMENT_ALGORITHM,
} from "@/lib/server/crackpotEngine";
import type { CrackPotCycle, CrackPotVersion } from "@/lib/crackpotTypes";

// ── Constants ─────────────────────────────────────────────────────────────────

const CELO_CHAIN_ID = celo.id; // 42220

function crackpotAddr(chainId: number): Hex {
  if (chainId === 8453) {
    return (process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS ?? "") as Hex;
  }
  return (process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? "") as Hex;
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
 * The commitment is computed before the openCycle tx so it can be passed to the
 * contract.  The salt is stored in the DB and revealed after the cycle ends.
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

async function insertCycleFromChain(
  chainCycle: ContractCycle,
  secret: [number, number, number, number],
  salt: string,
  commitment: Hex,
  openTxHash: string | null,
  version: CrackPotVersion,
  chainId: number,
): Promise<string> {
  const now = new Date();
  const theme = getThemeForCycle(now);
  const potBalance  = chainPotToDb(chainCycle.potBalance,  version);
  const potCap      = chainPotToDb(chainCycle.potCap,      version);
  const seedAmount  = chainPotToDb(chainCycle.seedAmount,  version);
  const expiresAt   = new Date(Number(chainCycle.expiresAt) * 1000).toISOString();
  const contractVersionInt = Number(chainCycle.version);
  const contractCycleId    = Number(chainCycle.id);

  const { data, error } = await supabase
    .from("crackpot_cycles")
    .insert({
      version,
      theme,
      secret_code:          secret,
      entropy_source:       "chain",
      status:               "active",
      pot_balance:          potBalance,
      pot_cap:              potCap,
      seed_amount:          seedAmount,
      expires_at:           expiresAt,
      chain_id:             chainId,
      contract_cycle_id:    contractCycleId,
      contract_version:     contractVersionInt,
      secret_salt:          salt,
      secret_commitment:    commitment,
      open_tx_hash:         openTxHash,
      commitment_algorithm: COMMITMENT_ALGORITHM,
    })
    .select("id")
    .single();

  if (error) throw new Error(`[crackpotCycleSync] DB insert failed: ${error.message}`);
  return data.id as string;
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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns the current active (or settling) cycle for the given version,
 * synchronised with chain state.  Never returns secret_code or secret_salt.
 *
 * @param version    "miles" | "usdt"
 * @param chainId    Celo chain ID (default 42220)
 */
export async function getOrSyncActiveCycle(
  version: "miles" | "usdt",
  chainId: number = CELO_CHAIN_ID,
): Promise<CrackPotCycle> {
  const contractVersion: ContractVersionType =
    version === "usdt" ? ContractVersion.USDT : ContractVersion.MILES;
  const nowSec = Math.floor(Date.now() / 1000);

  // ── Step 1: Read active on-chain cycle ───────────────────────────────────
  let chainCycle = await contractGetActiveCycle(contractVersion, chainId);

  // ── Step 2: Expire stale on-chain cycle ─────────────────────────────────
  if (chainCycle && Number(chainCycle.expiresAt) <= nowSec) {
    const staleId      = Number(chainCycle.id);
    let expireTxHash: string | null = null;

    try {
      expireTxHash = await contractExpireCycle(contractVersion, chainId);
    } catch (err: any) {
      const msg = String(err?.shortMessage ?? err?.message ?? "").toLowerCase();
      const isRace = msg.includes("no active cycle") ||
                     msg.includes("nocycleactive") ||
                     msg.includes("cyclenotexpired") ||
                     msg.includes("not expired");
      if (!isRace) throw err;
    }

    await markDbRowDead(chainId, contractVersion, staleId, expireTxHash);
    chainCycle = null; // will open a fresh cycle below
  }

  // ── Step 3: Open new cycle if none active on-chain ───────────────────────
  if (!chainCycle) {
    const entropy        = String(Date.now());
    const expiresAt      = getCycleExpiresAt(version);
    const contractAddr   = crackpotAddr(chainId);
    const { secret, salt, commitment } = generateSecretWithCommitment(
      entropy,
      chainId,
      contractVersion,
      expiresAt,
      contractAddr,
    );

    let openTxHash: string | null = null;
    let raceOpen = false;

    try {
      openTxHash = await contractOpenCycle(contractVersion, expiresAt, commitment, chainId);
    } catch (err: any) {
      const msg = String(err?.shortMessage ?? err?.message ?? "").toLowerCase();
      if (msg.includes("already active") || msg.includes("cyclealreadyactive")) {
        raceOpen = true;
      } else {
        // openCycle failed — do NOT write to DB; bubble the error up.
        throw err;
      }
    }

    // Re-read chain after open (or after CycleAlreadyActive race).
    chainCycle = await contractGetActiveCycle(contractVersion, chainId);
    if (!chainCycle) {
      throw new Error("[crackpotCycleSync] openCycle reported success but no active cycle found on-chain");
    }

    const contractCycleId = Number(chainCycle.id);
    const existing = await findDbRowByContractCycle(chainId, contractVersion, contractCycleId);

    if (!existing) {
      if (raceOpen) {
        // Another worker opened the chain cycle, so only that worker knows the
        // secret preimage for the on-chain commitment. Inventing a new secret
        // here would break the fairness proof. Fail closed instead.
        throw new Error(
          "[crackpotCycleSync] chain cycle opened by another worker has no DB preimage",
        );
      }

      const rowId = await insertCycleFromChain(
        chainCycle, secret, salt, commitment,
        openTxHash,
        version, chainId,
      );
      return fetchFullDbRow(rowId);
    }

    return fetchFullDbRow(existing.id);
  }

  // ── Step 4: Active chain cycle — ensure DB row exists (repair if missing) ─
  const contractCycleId = Number(chainCycle.id);
  const existing = await findDbRowByContractCycle(chainId, contractVersion, contractCycleId);

  if (!existing) {
    // Chain has an active cycle but DB row is absent. The contract only stores
    // the commitment, not the preimage, so a server that lacks the DB row cannot
    // safely reconstruct the secret. Fail closed instead of creating an
    // unverifiable replacement secret.
    throw new Error(
      "[crackpotCycleSync] active chain cycle has no DB preimage",
    );
  }

  return fetchFullDbRow(existing.id);
}
