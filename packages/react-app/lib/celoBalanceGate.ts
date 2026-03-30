// lib/celoBalanceGate.ts
//
// Returns true if the address holds any non-zero balance in at least one of:
// CELO (native), cUSD, USDT, or USDC on Celo mainnet.
// Used to gate partner quests, referrals, and profile milestones against
// freshly-created empty wallets.

import { erc20Abi } from "viem";
import { celoClient } from "@/lib/celoClient";

const STABLE_TOKENS: { symbol: string; address: `0x${string}`; decimals: number }[] = [
  { symbol: "cUSD", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18 },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6  },
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6  },
];

export async function hasAnyBalance(address: string): Promise<boolean> {
  const addr = address as `0x${string}`;

  // Check CELO native balance
  const celoBalance = await celoClient.getBalance({ address: addr });
  if (celoBalance > 0n) return true;

  // Check stablecoin balances in parallel
  const results = await Promise.allSettled(
    STABLE_TOKENS.map((t) =>
      celoClient.readContract({
        address: t.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addr],
      })
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled" && (r.value as bigint) > 0n) return true;
  }

  return false;
}
