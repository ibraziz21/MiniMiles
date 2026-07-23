// Shared Miles balance computation — chain (claimed, on-chain ERC-20) +
// Platform ledger (unclaimed in-store scans). Extracted from
// app/(protected)/me/page.tsx so /pass, /welcome and the new home surfaces
// compute balance identically without duplicating the RPC call.
import { getLedgerBalance } from "@/lib/akiba/activity";

const MINIPOINTS = process.env.MINIPOINTS_ADDRESS;
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

export async function readChainBalance(address: string): Promise<number> {
  if (!MINIPOINTS) {
    console.warn("[balance] readChainBalance: MINIPOINTS_ADDRESS not set, returning 0");
    return 0;
  }
  try {
    const data =
      "0x70a08231" + address.replace("0x", "").toLowerCase().padStart(64, "0");
    const res = await fetch(CELO_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_call",
        params: [{ to: MINIPOINTS, data }, "latest"],
      }),
      cache: "no-store",
    });
    const json = await res.json();
    if (!json.result || json.result === "0x") return 0;
    return Number(BigInt(json.result) / BigInt(1e18));
  } catch (err) {
    console.error("[balance] readChainBalance: RPC call failed →", err);
    return 0;
  }
}

export type UserBalance = {
  chainBalance: number;
  ledgerBalance: number;
  balance: number;
  hasBalance: boolean;
};

export async function getUserBalance(opts: {
  walletAddress: string | null;
  email: string | null;
}): Promise<UserBalance> {
  const { walletAddress, email } = opts;
  const [chainBalance, ledgerBalance] = await Promise.all([
    walletAddress ? readChainBalance(walletAddress) : Promise.resolve(0),
    getLedgerBalance({ email, walletAddress }),
  ]);
  return {
    chainBalance,
    ledgerBalance,
    balance: chainBalance + ledgerBalance,
    hasBalance: walletAddress !== null || ledgerBalance > 0,
  };
}
