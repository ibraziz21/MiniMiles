// lib/server/crackpotEntryVerifier.ts
//
// Verifies that a submitted tx hash represents a valid CrackPot `enterGame` call
// on the active CrackPot cycle, made by the authenticated session wallet.
//
// Security properties enforced:
//   1. Receipt must exist and status === "success".
//   2. tx.to must be the known CrackPot proxy address.
//   3. Logs must contain EntryRecorded from the CrackPot proxy address.
//   4. Decoded `player` must equal the session wallet (case-insensitive).
//   5. Decoded `cycleId` must match the DB cycle's contract_cycle_id.
//   6. entryAmount must meet the configured minimum entry fee for the version.
//   7. DB cycle must have chain fields set (fail closed if missing).
//   8. DB cycle chain_id must match the expected chain.
//   9. DB cycle contract_version must match the requested version.
//
// The public client is accepted as an injectable parameter so callers can
// pass a mock in unit tests without patching module-level state.

import { createPublicClient, decodeEventLog, http, parseAbi, type PublicClient } from "viem";
import { celo, base } from "viem/chains";
import { ENTRY_FEE_MILES, ENTRY_FEE_USDT, type CrackPotVersion } from "@/lib/crackpotTypes";

type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;

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
  | {
      ok: false;
      reason: string;
      /** Set for cycle_mismatch: the cycle the entry actually recorded into. */
      txCycleId?: bigint;
      entryAmount?: bigint;
      logIndex?: number;
    };

// ── Verifier ──────────────────────────────────────────────────────────────────

function contractVersionFor(version: PlayVersion): number {
  return version === "usdt" ? 1 : 0;
}

function minimumEntryAmount(version: PlayVersion): bigint {
  if (version === "usdt") {
    return BigInt(Math.round(ENTRY_FEE_USDT * 1_000_000)); // 6-dec USDT
  }
  return BigInt(ENTRY_FEE_MILES) * 10n ** 18n; // 18-dec AkibaMiles
}

/**
 * Verify a submitted CrackPot entry tx against the active CrackPot cycle.
 *
 * @param txHash        Hex tx hash from the player client.
 * @param sessionWallet Authenticated wallet address (from iron-session).
 * @param activeCycle   Active DB cycle record (must have chain fields from migration 024).
 * @param chainId       Expected chain (e.g. 42220 for Celo).
 * @param version       CrackPot version being entered.
 * @param client        Optional public client — inject a mock in tests.
 */
export async function verifyCrackPotEntry(
  txHash: string,
  sessionWallet: string,
  activeCycle: ActiveCycleRef,
  chainId: number,
  version: PlayVersion,
  client?: PublicClient,
): Promise<EntryVerifyResult> {
  // Fail closed: cycle must have chain fields from migration 024.
  if (
    activeCycle.contract_cycle_id == null ||
    activeCycle.chain_id == null ||
    activeCycle.contract_version == null
  ) {
    return { ok: false, reason: "cycle_no_chain_fields" };
  }
  if (activeCycle.chain_id !== chainId) {
    return { ok: false, reason: "chain_id_mismatch" };
  }
  if (activeCycle.contract_version !== contractVersionFor(version)) {
    return { ok: false, reason: "contract_version_mismatch" };
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
    // On mismatch, return the decoded details so the caller can distinguish
    // "entry landed in the previous cycle" (orphaned — log for credit) from
    // a genuinely invalid tx.
    if (Number(cycleId) !== activeCycle.contract_cycle_id) {
      return {
        ok: false,
        reason: "cycle_mismatch",
        txCycleId: cycleId,
        entryAmount,
        logIndex: log.logIndex ?? receipt.logs.indexOf(log),
      };
    }

    // ── Entry amount sanity check ───────────────────────────────────────────
    if (entryAmount < minimumEntryAmount(version)) {
      return { ok: false, reason: "entry_amount_too_low" };
    }

    const logIndex = log.logIndex ?? receipt.logs.indexOf(log);
    return { ok: true, logIndex, cycleId, entryAmount };
  }

  return { ok: false, reason: "no_entry_recorded_event" };
}

export function verifyUsdtEntry(
  txHash: string,
  sessionWallet: string,
  activeCycle: ActiveCycleRef,
  chainId: number,
  client?: PublicClient,
): Promise<EntryVerifyResult> {
  return verifyCrackPotEntry(txHash, sessionWallet, activeCycle, chainId, "usdt", client);
}
