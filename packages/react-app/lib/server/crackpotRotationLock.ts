// lib/server/crackpotRotationLock.ts
//
// Leased rotation lock backed by the crackpot_rotation_locks table
// (migration 027). Exactly one worker may perform cycle rotation
// (expireCycle/openCycle transactions) per lock key at a time.
//
// A leased row is used instead of pg advisory locks because Supabase REST
// connections are pooled — session-scoped locks can be claimed and released
// on different backend sessions.

import { supabase } from "@/lib/supabaseClient";

// Rotation worst case is two txs with receipt waits (~90s each) plus retries.
const LOCK_TTL_SECONDS = 240;

export function rotationLockKey(chainId: number, contractVersion: number): string {
  return `crackpot:rotate:${chainId}:${contractVersion}`;
}

/**
 * Try to claim the rotation lock. Returns true when this holder now owns the
 * lease. Fails OPEN when the RPC itself errors (e.g. migration not applied
 * yet) — losing mutual exclusion is recoverable, halting rotation is not.
 */
export async function acquireRotationLock(lockKey: string, holderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("crackpot_claim_rotation_lock", {
    p_key:         lockKey,
    p_holder:      holderId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });

  if (error) {
    console.warn("[crackpotRotationLock] claim RPC failed, proceeding without lock:", error.message);
    return true;
  }
  return data === true;
}

export async function releaseRotationLock(lockKey: string, holderId: string): Promise<void> {
  const { error } = await supabase.rpc("crackpot_release_rotation_lock", {
    p_key:    lockKey,
    p_holder: holderId,
  });
  if (error) console.warn("[crackpotRotationLock] release RPC failed:", error.message);
}
