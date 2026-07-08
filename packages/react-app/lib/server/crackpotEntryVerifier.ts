// lib/server/crackpotEntryVerifier.ts
//
// Verifies that a submitted tx hash represents a valid USDT `enterGame` call
// on the active CrackPot cycle, made by the authenticated session wallet.
//
// Security properties enforced:
//   1. Receipt must exist and status === "success".
//   2. tx.to must be the known CrackPot proxy address.
//   3. Logs must contain EntryRecorded from the CrackPot proxy address.
//   4. Decoded `player` must equal the session wallet (case-insensitive).
//   5. Decoded `cycleId` must match the DB cycle's contract_cycle_id.
//   6. entryAmount must meet the configured minimum entry fee.
//   7. DB cycle must have chain fields set (fail closed if missing).
//   8. DB cycle chain_id must match the expected chain.
//
// The public client is accepted as an injectable parameter so callers can
// pass a mock in unit tests without patching module-level state.

import { createPublicClient, decodeEventLog, http, parseAbi, type PublicClient } from "viem";
import { celo, base } from "viem/chains";
import { ENTRY_FEE_USDT } from "@/lib/crackpotTypes";

// Minimum USDT entry fee in micro-USDT (6-dec). The contract enforces this
// server-side too; we check here as belt-and-suspenders.
const ENTRY_FEE_MICRO = BigInt(Math.round(ENTRY_FEE_USDT * 1_000_000)); // 100_000n

// ABI fragment — only what we need for decoding.
export const ENTRY_RECORDED_ABI = parseAbi([
  "event EntryRecorded(uint256 indexed cycleId, address indexed player, uint256 entryAmount, uint256 newPotBalance)",
]);

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const BASE_RPC = process.env.BASE_RPC_URL  ?? "https://mainnet.base.org";

const CRACKPOT_ADDRESS: Record<number, string> = {
  [celo.id]: (process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? "").toLowerCase(),
  [base.id]: (process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS ?? "").toLowerCase(),
};

function defaultClient(chainId: number): PublicClient {
  if (chainId === base.id) {
    return createPublicClient({ chain: base, transport: http(BASE_RPC) }) as unknown as PublicClient;
  }
  return createPublicClient({ chain: celo, transport: http(CELO_RPC) }) as unknown as PublicClient;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Subset of the DB cycle row that the verifier needs. */
export type ActiveCycleRef = {
  id: string;                          // DB uuid
  contract_cycle_id: number | null;
  chain_id:          number | null;
  contract_version:  number | null;
};

export type EntryVerifyResult =
  | { ok: true;  logIndex: number; cycleId: bigint; entryAmount: bigint }
  | { ok: false; reason: string };

// ── Verifier ──────────────────────────────────────────────────────────────────

/**
 * Verify a submitted USDT entry tx against the active CrackPot cycle.
 *
 * @param txHash        Hex tx hash from the player client.
 * @param sessionWallet Authenticated wallet address (from iron-session).
 * @param activeCycle   Active DB cycle record (must have chain fields from migration 024).
 * @param chainId       Expected chain (e.g. 42220 for Celo).
 * @param client        Optional public client — inject a mock in tests.
 */
export async function verifyUsdtEntry(
  txHash: string,
  sessionWallet: string,
  activeCycle: ActiveCycleRef,
  chainId: number,
  client?: PublicClient,
): Promise<EntryVerifyResult> {
  // Fail closed: cycle must have chain fields from migration 024.
  if (activeCycle.contract_cycle_id == null || activeCycle.chain_id == null) {
    return { ok: false, reason: "cycle_no_chain_fields" };
  }
  if (activeCycle.chain_id !== chainId) {
    return { ok: false, reason: "chain_id_mismatch" };
  }

  const contractAddr = CRACKPOT_ADDRESS[chainId] ?? "";
  if (!contractAddr) {
    return { ok: false, reason: "crackpot_address_not_configured" };
  }

  const pubClient = client ?? defaultClient(chainId);

  // ── Fetch receipt ──────────────────────────────────────────────────────────
  let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
  try {
    receipt = await pubClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return { ok: false, reason: "receipt_not_found" };
  }

  if (!receipt) return { ok: false, reason: "receipt_not_found" };
  if (receipt.status !== "success") return { ok: false, reason: "tx_failed" };

  // ── Verify recipient ───────────────────────────────────────────────────────
  if (!receipt.to || receipt.to.toLowerCase() !== contractAddr) {
    return { ok: false, reason: "wrong_contract" };
  }

  // ── Decode EntryRecorded event ─────────────────────────────────────────────
  for (const log of receipt.logs) {
    // Only consider logs emitted by the CrackPot contract.
    if (log.address.toLowerCase() !== contractAddr) continue;

    let decoded: ReturnType<typeof decodeEventLog<typeof ENTRY_RECORDED_ABI>>;
    try {
      decoded = decodeEventLog({ abi: ENTRY_RECORDED_ABI, data: log.data, topics: log.topics });
    } catch {
      continue; // Unrelated event — skip.
    }

    if (decoded.eventName !== "EntryRecorded") continue;

    const { cycleId, player, entryAmount } = decoded.args as {
      cycleId: bigint;
      player: `0x${string}`;
      entryAmount: bigint;
      newPotBalance: bigint;
    };

    // ── Player must match session wallet ────────────────────────────────────
    if (player.toLowerCase() !== sessionWallet.toLowerCase()) {
      return { ok: false, reason: "player_mismatch" };
    }

    // ── Cycle ID must match the active DB cycle ─────────────────────────────
    if (Number(cycleId) !== activeCycle.contract_cycle_id) {
      return { ok: false, reason: "cycle_mismatch" };
    }

    // ── Entry amount sanity check ───────────────────────────────────────────
    if (entryAmount < ENTRY_FEE_MICRO) {
      return { ok: false, reason: "entry_amount_too_low" };
    }

    const logIndex = log.logIndex ?? receipt.logs.indexOf(log);
    return { ok: true, logIndex, cycleId, entryAmount };
  }

  return { ok: false, reason: "no_entry_recorded_event" };
}
