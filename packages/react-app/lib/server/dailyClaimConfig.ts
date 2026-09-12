// lib/server/dailyClaimConfig.ts
//
// Startup/first-use configuration validation for the daily self-claim path
// (docs/daily-checkin-self-claim-spec.md §9). If any check fails, voucher
// issuance must fail closed — it never silently falls back to the sponsored
// queue (that's an explicit operator action via DAILY_SELF_CLAIM_MODE=off).

import { celoClient } from "@/lib/celoClient";
import { DAILY_QUEST_CLAIMER_ABI, CELO_CHAIN_ID } from "@/lib/dailyQuestClaimer";
import { getVoucherSignerAddress } from "@/lib/server/dailyClaimSigner";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function getClaimerAddress(): `0x${string}` {
  const addr = process.env.DAILY_QUEST_CLAIMER_ADDRESS ?? "";
  if (!ADDRESS_RE.test(addr)) {
    throw new Error("[dailyClaimConfig] DAILY_QUEST_CLAIMER_ADDRESS is not a valid address");
  }
  return addr as `0x${string}`;
}

function getExpectedMilesTokenAddress(): `0x${string}` {
  const addr =
    process.env.MINIPOINTS_V2_ADDRESS ??
    process.env.NEXT_PUBLIC_MINIPOINTS_V2_ADDRESS ??
    "0xab93400000751fc17918940C202A66066885d628";
  return addr as `0x${string}`;
}

export type DailyClaimConfigCheck =
  | { ok: true; claimerAddress: `0x${string}` }
  | { ok: false; reason: string };

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cached: { at: number; result: DailyClaimConfigCheck } | null = null;

async function runValidation(): Promise<DailyClaimConfigCheck> {
  let claimerAddress: `0x${string}`;
  try {
    claimerAddress = getClaimerAddress();
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "invalid claimer address" };
  }

  let signerAddress: `0x${string}`;
  try {
    signerAddress = getVoucherSignerAddress();
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "QUEST_VOUCHER_SIGNER_KEY not configured" };
  }

  try {
    const chainId = await celoClient.getChainId();
    if (chainId !== CELO_CHAIN_ID) {
      return { ok: false, reason: `RPC chainId ${chainId} does not match Celo mainnet (${CELO_CHAIN_ID})` };
    }

    const code = await celoClient.getCode({ address: claimerAddress });
    if (!code || code === "0x") {
      return { ok: false, reason: `No contract code at claimer address ${claimerAddress}` };
    }

    const [onchainMilesToken, onchainSigner] = await Promise.all([
      celoClient.readContract({
        address: claimerAddress,
        abi: DAILY_QUEST_CLAIMER_ABI,
        functionName: "milesToken",
      }),
      celoClient.readContract({
        address: claimerAddress,
        abi: DAILY_QUEST_CLAIMER_ABI,
        functionName: "signer",
      }),
    ]);

    const expectedMilesToken = getExpectedMilesTokenAddress();
    if ((onchainMilesToken as string).toLowerCase() !== expectedMilesToken.toLowerCase()) {
      return {
        ok: false,
        reason: `Claimer milesToken() ${onchainMilesToken} does not match configured AkibaMiles V2 ${expectedMilesToken}`,
      };
    }

    if ((onchainSigner as string).toLowerCase() !== signerAddress.toLowerCase()) {
      return {
        ok: false,
        reason: "Claimer signer() does not match QUEST_VOUCHER_SIGNER_KEY-derived address",
      };
    }

    const isMinter = await celoClient.readContract({
      address: expectedMilesToken,
      abi: [
        {
          type: "function",
          name: "minters",
          stateMutability: "view",
          inputs: [{ name: "", type: "address" }],
          outputs: [{ type: "bool" }],
        },
      ] as const,
      functionName: "minters",
      args: [claimerAddress],
    });
    if (!isMinter) {
      return { ok: false, reason: "Claimer is not a registered minter on AkibaMiles V2" };
    }

    return { ok: true, claimerAddress };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "RPC validation failed" };
  }
}

/**
 * Validates on-chain/config invariants, caching the result briefly so every
 * voucher request doesn't re-hit the RPC. Never logs secrets — only the
 * mismatch reason (addresses, chain IDs).
 */
export async function validateDailyClaimConfig(): Promise<DailyClaimConfigCheck> {
  const now = Date.now();
  if (_cached && now - _cached.at < CACHE_TTL_MS) {
    return _cached.result;
  }
  const result = await runValidation();
  _cached = { at: now, result };
  return result;
}
