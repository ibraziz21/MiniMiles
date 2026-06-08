export type DailyClaimStep =
  | "checking"    // fetching voucher / verifying eligibility
  | "wallet"      // wallet TX popup open, waiting for user to confirm
  | "confirming"; // TX submitted, waiting for on-chain confirmation

export type ClaimOnchainFn = (voucher: {
  amount: string;
  dayNonce: string;
  deadline: string;
  signature: `0x${string}`;
  contractAddress: `0x${string}`;
}) => Promise<`0x${string}`>;

/**
 * claimDailyQuest
 *
 * On-chain path (when claimOnchain is provided):
 *   1. POST /api/quests/daily/voucher  → atomic DB lock + signed voucher
 *   2. User submits TX on-chain        → contract mints Miles to user
 *   3. POST /api/quests/daily/confirm  → stamps tx_hash on the DB row
 *
 * Fallback path (when claimOnchain is undefined — contract not deployed yet):
 *   POST /api/quests/daily → existing queued backend-mint flow
 */
export async function claimDailyQuest(
  userAddress: string,
  claimOnchain?: ClaimOnchainFn,
  onStep?: (step: DailyClaimStep) => void
) {
  // ── On-chain path ─────────────────────────────────────────────────────────
  if (claimOnchain) {
    onStep?.("checking");

    const voucherRes = await fetch("/api/quests/daily/voucher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const voucher = await voucherRes.json();

    if (!voucher.success) {
      return voucher; // already / error / insufficient-activity — pass through unchanged
    }

    onStep?.("wallet");

    let txHash: `0x${string}`;
    try {
      txHash = await claimOnchain({
        amount:          voucher.amount,
        dayNonce:        voucher.dayNonce,
        deadline:        voucher.deadline,
        signature:       voucher.signature,
        contractAddress: voucher.contractAddress,
      });
    } catch (e: any) {
      // User rejected the TX, or the contract reverted (e.g. AlreadyClaimed).
      // The DB row written by the voucher route stays — one attempt per day.
      return {
        success: false,
        message: e?.shortMessage ?? e?.message ?? "Transaction rejected",
      };
    }

    onStep?.("confirming");

    // Stamp tx_hash on the existing DB row. Non-blocking — a failure here
    // doesn't undo the on-chain mint; it just means tx_hash won't be stored.
    fetch("/api/quests/daily/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    }).catch((e) => console.warn("[claimDaily] confirm call failed (non-fatal):", e));

    return {
      success: true,
      txHash,
      queued:  false,
      points:  voucher.points,
      onchain: true,
    };
  }

  // ── Fallback: queued backend-mint path ────────────────────────────────────
  const res = await fetch("/api/quests/daily", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress }),
  });
  return res.json();
}
