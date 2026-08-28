// Canonical "how many Miles can this member actually spend right now"
// resolution — extracted from the voucher quote route
// (api/shop/vouchers/quote/route.ts), which is the strictest, most accurate
// balance computation in the codebase: verified wallets only, the canonical
// ledger (available_ledger_points RPC, not the simpler getLedgerBalance used
// by getUserBalance()), a strict on-chain read that distinguishes a real
// zero from an RPC failure, and pending/processing/reconciliation-required
// burn reservations subtracted out. getUserBalance() is display-only and can
// diverge from what the quote endpoint will actually honor (chain RPC
// failures silently read as 0 there; legacy-unverified wallets count).
//
// The on-chain portion is resolved lazily/non-fatally: a member whose
// ledger balance alone covers what they need was never blocked by a flaky
// chain RPC before this extraction, and must not be blocked by one now.
// `chainStatus` lets a caller that actually needs on-chain funds distinguish
// "verified $0" from "couldn't verify" and react accordingly.
import { createAdminClient } from "@/lib/supabase/admin";
import { readChainBalanceStrict } from "@/lib/akiba/balance";

export type VoucherSpendableBalance =
  | { ok: false; reason: "identity_unresolved" | "ledger_unavailable" }
  | {
      ok: true;
      walletAddress: string | null;
      ledgerBalance: number;
      /** null only when a wallet exists and its on-chain balance could not be verified. */
      chainBalance: number | null;
      chainStatus: "no_wallet" | "resolved" | "chain_unavailable" | "reserved_unavailable";
      /** ledgerBalance + chainBalance, or null when chainBalance is unknown — never a fabricated total. */
      balance: number | null;
    };

export async function getVoucherSpendableBalance(opts: {
  hubUserId: string;
  email: string | null;
}): Promise<VoucherSpendableBalance> {
  const admin = createAdminClient();

  const { data: linkedWallets } = await admin
    .from("hub_user_wallets")
    .select("address, is_primary, linked_at")
    .eq("user_id", opts.hubUserId)
    .eq("verification_status", "verified")
    .order("linked_at", { ascending: false });
  const walletRows = (linkedWallets ?? []) as Array<{
    address: string;
    is_primary: boolean;
    linked_at: string;
  }>;
  const wallets = walletRows.map((w) => w.address.toLowerCase());
  const walletAddress =
    walletRows.find((w) => w.is_primary)?.address.toLowerCase() ?? wallets[0] ?? null;

  const { data: canonicalIds, error: resolveErr } = await admin.rpc("resolve_canonical_ids", {
    p_email: opts.email ?? null,
    p_wallets: wallets,
  });
  if (resolveErr) return { ok: false, reason: "identity_unresolved" };

  const { data: availableLedger, error: ledgerErr } = await admin.rpc("available_ledger_points", {
    p_canonical_ids: canonicalIds ?? [],
  });
  if (ledgerErr) return { ok: false, reason: "ledger_unavailable" };
  const ledgerBalance = Math.max(availableLedger ?? 0, 0);

  if (!walletAddress) {
    return {
      ok: true,
      walletAddress: null,
      ledgerBalance,
      chainBalance: 0,
      chainStatus: "no_wallet",
      balance: ledgerBalance,
    };
  }

  const chain = await readChainBalanceStrict(walletAddress);
  if (!chain.ok) {
    return {
      ok: true,
      walletAddress,
      ledgerBalance,
      chainBalance: null,
      chainStatus: "chain_unavailable",
      balance: null,
    };
  }

  const { data: reservedRows, error: reservedErr } = await admin
    .from("minipoint_burn_jobs")
    .select("points")
    .eq("user_address", walletAddress)
    .in("status", ["pending", "processing", "reconciliation_required"]);
  if (reservedErr) {
    return {
      ok: true,
      walletAddress,
      ledgerBalance,
      chainBalance: null,
      chainStatus: "reserved_unavailable",
      balance: null,
    };
  }
  const reserved = (reservedRows ?? []).reduce(
    (sum: number, row: { points: number }) => sum + Number(row.points),
    0,
  );
  const chainBalance = Math.max(chain.balance - reserved, 0);

  return {
    ok: true,
    walletAddress,
    ledgerBalance,
    chainBalance,
    chainStatus: "resolved",
    balance: ledgerBalance + chainBalance,
  };
}
