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
 * SECURITY MODEL
 * ──────────────
 * Outcome manifests are server-only. Production reads from Supabase using the
 * service-role key, with RLS enabled and no client-side access. Local/dev can
 * still use CLAW_BATCH_STORE_JSON or CLAW_BATCH_STORE_FILE.
 *
 * PRODUCTION INTEGRATION BOUNDARY
 * ────────────────────────────────
 * In production, batches are generated off-chain by a separate batch-builder
 * service that is NOT present in this repo. That service:
 *   1. Generates N outcomes (reward_class[]) weighted by tier probabilities
 *   2. Builds a Merkle tree where each leaf = keccak256(batchId, playIndex, rewardClass)
 *   3. Publishes the Merkle root on-chain via MerkleBatchRng.openBatch()
 *   4. Stores the full batch manifest (all outcomes + per-index proofs) in
 *      Supabase before opening the on-chain batch.
 *
 * CURRENT IMPLEMENTATION
 * ──────────────────────
 * Batch manifest is loaded from either:
 *   - Supabase table claw_batch_manifests by batch_id
 *   - CLAW_BATCH_STORE_JSON: inline JSON string
 *   - CLAW_BATCH_STORE_FILE: absolute or project-relative path to the JSON file
 *
 * Format:
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
 * TODO (production hardening):
 *   - [ ] Add HMAC signature verification on batch manifest
 *   - [ ] Rotate manifests per batch close event
 *   - [ ] Add rate-limit / audit log on every proof fetch
 */

import fs from "fs";
import path from "path";
import { supabase } from "@/lib/supabaseClient";

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
let _storeFileMtimeMs: number | null = null;
const _supabaseBatchCache = new Map<string, BatchManifest | null>();

function loadStore(): BatchStore {
  let raw = process.env.CLAW_BATCH_STORE_JSON;
  const file = process.env.CLAW_BATCH_STORE_FILE;

  if (_store !== null && raw) return _store;

  if (!raw && file) {
    const manifestPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    try {
      const stat = fs.statSync(manifestPath);
      if (_store !== null && _storeFileMtimeMs === stat.mtimeMs) return _store;
      _storeFileMtimeMs = stat.mtimeMs;
      raw = fs.readFileSync(manifestPath, "utf8");
    } catch (e) {
      console.error("[clawBatchStore] Failed to read CLAW_BATCH_STORE_FILE:", e);
    }
  }

  if (!raw) {
    // ── TODO: replace this stub with your production batch-data source ──
    // When no manifest is configured, we return an empty store.
    // settle() will detect this and return a soft 503 that the frontend
    // can retry — the session will NOT get stuck in a broken state.
    console.warn(
      "[clawBatchStore] CLAW_BATCH_STORE_JSON is not set. " +
      "CLAW_BATCH_STORE_FILE is not set or unreadable. " +
      "All outcome lookups will return NOT_READY. " +
      "Configure a server-only batch manifest to enable settlement."
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

async function loadSupabaseBatchManifest(batchId: string): Promise<BatchManifest | null> {
  if (_supabaseBatchCache.has(batchId)) {
    return _supabaseBatchCache.get(batchId) ?? null;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    _supabaseBatchCache.set(batchId, null);
    return null;
  }

  const { data, error } = await supabase
    .from("claw_batch_manifests")
    .select("manifest")
    .eq("batch_id", batchId)
    .maybeSingle();

  if (error) {
    console.error("[clawBatchStore] Failed to load Supabase manifest:", error);
    _supabaseBatchCache.set(batchId, null);
    return null;
  }

  const rawManifest = data?.manifest as BatchManifest | BatchStore | null | undefined;
  const manifest = rawManifest && "plays" in rawManifest
    ? rawManifest as BatchManifest
    : rawManifest?.[batchId] ?? null;

  _supabaseBatchCache.set(batchId, manifest);
  return manifest;
}

export async function getBatchPlayOutcomeAsync(
  batchId: string,
  playIndex: number
): Promise<BatchPlayOutcome | null> {
  const supabaseManifest = await loadSupabaseBatchManifest(batchId);
  const manifest = supabaseManifest ?? loadStore()[batchId] ?? null;
  if (!manifest) return null;

  return manifest.plays.find((p) => p.playIndex === playIndex) ?? null;
}

/**
 * Returns true if the batch store has any data at all.
 * Used by the rotate route to distinguish "not configured" from
 * "batch not found in store".
 */
export function isBatchStoreConfigured(): boolean {
  const raw = process.env.CLAW_BATCH_STORE_JSON;
  const file = process.env.CLAW_BATCH_STORE_FILE;
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
  return hasSupabase || !!raw || !!file;
}

export async function hasBatchManifest(batchId: string): Promise<boolean> {
  const supabaseManifest = await loadSupabaseBatchManifest(batchId);
  if (supabaseManifest?.plays?.length) return true;

  const store = loadStore();
  return !!store[batchId]?.plays?.length;
}
