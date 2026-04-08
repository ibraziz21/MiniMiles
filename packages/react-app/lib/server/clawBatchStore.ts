/**
 * lib/server/clawBatchStore.ts
 *
 * SERVER-ONLY — never import from client components or pages.
 * Next.js will tree-shake this file from the browser bundle as long as it
 * is only imported from API routes (app/api/**) or server components.
 *
 * PURPOSE
 * ───────
 * This module is the exclusive server-side source of batch outcome material:
 *   - reward_class (uint8, 0-5) for a given (batchId, playIndex)
 *   - merkle_proof (bytes32[] hex strings) for commitOutcome()
 *
 * WHY NOT SUPABASE
 * ────────────────
 * Storing plaintext reward_class and merkle_proof in Supabase creates a
 * leak surface: any service-role key leak, SQL injection, or mis-configured
 * RLS would expose outcome data before settlement. This module keeps that
 * material in a server-only layer (environment variable or private storage).
 *
 * PRODUCTION INTEGRATION BOUNDARY
 * ────────────────────────────────
 * In production, batches are generated off-chain by a separate batch-builder
 * service that is NOT present in this repo. That service:
 *   1. Generates N outcomes (reward_class[]) weighted by tier probabilities
 *   2. Builds a Merkle tree where each leaf = keccak256(batchId, playIndex, rewardClass)
 *   3. Publishes the Merkle root on-chain via MerkleBatchRng.openBatch()
 *   4. Stores the full batch manifest (all outcomes + per-index proofs) in
 *      CLAW_BATCH_STORE_JSON (see below) — encrypted at rest, server-only.
 *
 * CURRENT IMPLEMENTATION
 * ──────────────────────
 * Batch manifest is loaded from the CLAW_BATCH_STORE_JSON environment variable.
 * Format (JSON string):
 *
 *   {
 *     "<batchId>": {
 *       "plays": [
 *         {
 *           "playIndex": 0,
 *           "rewardClass": 1,
 *           "proof": ["0xabc...", "0xdef..."]
 *         },
 *         ...
 *       ]
 *     }
 *   }
 *
 * Set CLAW_BATCH_STORE_JSON in your .env.local (never commit it).
 * In Vercel/production, inject it via environment variable secrets.
 *
 * TODO (production hardening):
 *   - [ ] Replace env-var store with encrypted fetch from a private KMS/S3
 *   - [ ] Add HMAC signature verification on batch manifest
 *   - [ ] Rotate manifests per batch close event
 *   - [ ] Add rate-limit / audit log on every proof fetch
 */

export type BatchPlayOutcome = {
  playIndex: number;
  rewardClass: number;
  proof: `0x${string}`[];
};

type BatchManifest = {
  plays: BatchPlayOutcome[];
};

type BatchStore = Record<string, BatchManifest>;

// Module-level cache — loaded once per server process lifetime
let _store: BatchStore | null = null;

function loadStore(): BatchStore {
  if (_store !== null) return _store;

  const raw = process.env.CLAW_BATCH_STORE_JSON;
  if (!raw) {
    // ── TODO: replace this stub with your production batch-data source ──
    // When no manifest is configured, we return an empty store.
    // settle() will detect this and return a soft 503 that the frontend
    // can retry — the session will NOT get stuck in a broken state.
    console.warn(
      "[clawBatchStore] CLAW_BATCH_STORE_JSON is not set. " +
      "All outcome lookups will return NOT_READY. " +
      "Configure this env var with your batch manifest to enable settlement."
    );
    _store = {};
    return _store;
  }

  try {
    _store = JSON.parse(raw) as BatchStore;
    return _store;
  } catch (e) {
    console.error("[clawBatchStore] Failed to parse CLAW_BATCH_STORE_JSON:", e);
    _store = {};
    return _store;
  }
}

/**
 * Look up the outcome for a specific (batchId, playIndex) pair.
 *
 * Returns null if:
 *   - The batch manifest is not configured (CLAW_BATCH_STORE_JSON missing)
 *   - The batchId is not in the manifest
 *   - The playIndex is out of range
 *
 * Callers must treat null as "not ready" and return a retryable error to
 * the frontend — never a hard 500.
 */
export function getBatchPlayOutcome(
  batchId: string,
  playIndex: number
): BatchPlayOutcome | null {
  const store = loadStore();
  const manifest = store[batchId];
  if (!manifest) return null;

  const play = manifest.plays.find((p) => p.playIndex === playIndex);
  return play ?? null;
}

/**
 * Returns true if the batch store has any data at all.
 * Used by the rotate route to distinguish "not configured" from
 * "batch not found in store".
 */
export function isBatchStoreConfigured(): boolean {
  const raw = process.env.CLAW_BATCH_STORE_JSON;
  return !!raw;
}
