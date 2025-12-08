// src/helpers/walletStableBalance.ts
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "viem";

/* ----------------------------------------------------------------- config */

/**
 * Two known stables from your daily transfer helper:
 */
const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

/**
 * Optional 3rd stable — configure via env:
 *  - STABLE3_ADDRESS
 *  - STABLE3_DECIMALS
 */
const STABLE3_ADDRESS = (process.env.STABLE3_ADDRESS ?? "") as `0x${string}` | "";
const STABLE3_DECIMALS = Number(process.env.STABLE3_DECIMALS ?? "6");

/** decimals lookup: 1 token unit = 10^decimals */
const STABLES: { address: `0x${string}` | ""; decimals: number }[] = [
  { address: CUSD_ADDRESS as `0x${string}`, decimals: 18 },
  { address: USDT_ADDRESS as `0x${string}`, decimals: 6 },
  { address: STABLE3_ADDRESS, decimals: STABLE3_DECIMALS },
];

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

/* ---------------------------------------------------------------- helpers */

/**
 * Reads the user's wallet balances of all configured stables on Celo
 * and returns the **sum in USD** (assuming 1:1 to USD).
 */
export async function getUserStableWalletBalanceUsd(
  userAddress: string
): Promise<number> {
  const safeAddr = userAddress as `0x${string}`;

  const balances = await Promise.all(
    STABLES.filter((s) => s.address && s.decimals > 0).map(async (token) => {
      try {
        const raw = (await publicClient.readContract({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [safeAddr],
        })) as bigint;

        return Number(raw) / 10 ** token.decimals;
      } catch (e) {
        console.error(
          "[getUserStableWalletBalanceUsd] balanceOf failed for",
          token.address,
          e
        );
        return 0;
      }
    })
  );

  return balances.reduce((sum, v) => sum + v, 0);
}

/**
 * True if wallet holds ≥ minUsd across all stables combined.
 */
export async function userStableWalletBalanceAtLeastUsd(
  userAddress: string,
  minUsd: number
): Promise<boolean> {
  const total = await getUserStableWalletBalanceUsd(userAddress);
  return total >= minUsd;
}
