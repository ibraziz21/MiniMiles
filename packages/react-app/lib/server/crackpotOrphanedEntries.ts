// lib/server/crackpotOrphanedEntries.ts
//
// Records paid CrackPot entries that can no longer be turned into an attempt
// (cycle rotated between payment and attempt/start, or the cycle had no
// playable time left). One row per (chain_id, tx_hash) — retries are no-ops.
//
// These rows are the reconciliation queue for crediting/refunding players;
// see migration 028.

import { supabase } from "@/lib/supabaseClient";

export type OrphanedEntryReason = "cycle_rotated" | "entry_too_late" | "attempt_limit_reached";

export type OrphanedEntryParams = {
  chainId:         number;
  txHash:          string;
  logIndex:        number | null;
  playerAddress:   string;
  version:         "miles" | "usdt";
  contractCycleId: number | null;
  /** Raw on-chain entry amount as a decimal string; null when unknown. */
  entryAmount:     string | null;
  reason:          OrphanedEntryReason;
};

/**
 * Insert an orphaned-entry row. Throws on failure — callers promise the
 * player their payment was logged, so a silent logging failure is worse than
 * a retryable 500. Duplicate (chain_id, tx_hash) inserts are ignored.
 */
export async function recordOrphanedEntry(params: OrphanedEntryParams): Promise<void> {
  const { error } = await supabase
    .from("crackpot_orphaned_entries")
    .upsert(
      {
        chain_id:          params.chainId,
        tx_hash:           params.txHash.toLowerCase(),
        log_index:         params.logIndex,
        player_address:    params.playerAddress.toLowerCase(),
        version:           params.version,
        contract_cycle_id: params.contractCycleId,
        entry_amount:      params.entryAmount,
        reason:            params.reason,
      },
      { onConflict: "chain_id,tx_hash", ignoreDuplicates: true },
    );

  if (error) {
    throw new Error(`[crackpotOrphanedEntries] record failed: ${error.message}`);
  }
}
