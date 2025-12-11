// src/lib/prosperity-pass-claim.ts

import { createClient } from "@supabase/supabase-js";
import { fetchSuperAccountForOwner } from "./prosperity-pass";

export type ClaimPassResult = {
  superChainID: string;
  smartAccount?: string;
  txHash?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn(
    "[ProsperityPassClaim] Supabase env vars missing. Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_SERVICE_KEY."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/* ───────────────── Internal helpers ───────────────── */

async function getUsernameForAddress(address: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("username")
      .eq("user_address", address.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error("[ProsperityPassClaim] username fetch error:", error);
      return null;
    }

    return data?.username ?? null;
  } catch (e) {
    console.error("[ProsperityPassClaim] username fetch exception:", e);
    return null;
  }
}

/**
 * Build the SuperChainID:
 *  - If user has username "ibra" → "ibra.akiba"
 *  - If no username, fallback to "user-<addrPrefix>.akiba"
 */
function makeSuperChainId(username: string | null, address: string): string {
  let base: string;
  if (username && username.trim().length > 0) {
    base = username.trim().toLowerCase();
  } else {
    const suffix = address.replace(/^0x/, "").slice(0, 6).toLowerCase();
    base = `user-${suffix}`;
  }
  return `${base}.akiba`;
}

/**
 * Stub: ensure uniqueness of the SuperChainID.
 * For now we return the generated id as-is.
 * You can later extend this to append "-1", "-2", etc. if you detect collisions.
 */
async function ensureUniqueSuperChainId(candidate: string): Promise<string> {
  // TODO: extend this to actually check uniqueness (Supabase table or on-chain check)
  return candidate;
}

/**
 * Create the actual Eco Account / Super Account using Safe, via API route.
 * This calls /api/prosperity-pass/create-super-account which:
 *  - Deploys a Safe
 *  - Runs setupSuperChainAccount with your SuperChain module/guard/4337 module
 */
async function createSuperAccountForUser(opts: {
  owner: string;
  superChainID: string;
}): Promise<{ smartAccount?: string; txHash?: string }> {
  const { owner, superChainID } = opts;

  try {
    const res = await fetch("/api/create-super-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, superChainID }),
    });

    if (!res.ok) {
      let msg = "Failed to create Prosperity Pass account";
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }

    const body = await res.json();

    console.info(
      "[ProsperityPassClaim] Created Super Account:",
      body.safeAddress,
      "tx:",
      body.txHash
    );

    return {
      smartAccount: body.safeAddress as string | undefined,
      txHash: body.txHash as string | undefined,
    };
  } catch (e) {
    console.error("[ProsperityPassClaim] createSuperAccountForUser error:", e);
    throw e;
  }
}

/* ───────────────── Public entrypoint ───────────────── */

/**
 * NOTE: pointsToBurn is kept for now for semantics / future checks,
 * but the actual burn is done client-side via useWeb3().burnAkibaMiles.
 */
export async function claimProsperityPassForAddress(
  address: string,
  pointsToBurn: number
): Promise<ClaimPassResult> {
  if (!address) {
    throw new Error("Wallet address is required to claim a Prosperity Pass");
  }

  // Step 2: prevent double-claim by checking on-chain first
  const { hasPassport } = await fetchSuperAccountForOwner(address);
  if (hasPassport) {
    throw new Error("You already have a Prosperity Pass");
  }

  // Step 1: Check `users` table for username
  const username = await getUsernameForAddress(address);

  // Build "ibra.akiba" or fallback "user-xxxxxx.akiba"
  const candidateId = makeSuperChainId(username, address);

  // Step 2.5: ensure uniqueness (no-op for now)
  const superChainID = await ensureUniqueSuperChainId(candidateId);

  // 🔥 Burn is now done in the UI via useWeb3().burnAkibaMiles

  // Step 4: Create pass (Eco Account / Super Account)
  const { smartAccount, txHash } = await createSuperAccountForUser({
    owner: address,
    superChainID,
  });

  return {
    superChainID,
    smartAccount,
    txHash,
  };
}
