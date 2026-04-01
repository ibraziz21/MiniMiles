import { erc20Abi } from "viem";
import { celoClient } from "@/lib/celoClient";

const CELO_BLOCK_TIME_SECS = 5;
const MIN_STABLE_HOLD_DAYS = Number(process.env.MIN_STABLE_HOLD_DAYS ?? "1");

const SUPPORTED_STABLES: { symbol: string; address: `0x${string}` }[] = [
  { symbol: "cUSD", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a" },
  { symbol: "USDT", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" },
  { symbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" },
];

type StableHoldCheckResult =
  | { ok: true; token: string }
  | { ok: false; status: 403; reason: "no-stable-balance" | "stable-too-new"; message: string };

export async function checkStableHoldRequirement(address: string): Promise<StableHoldCheckResult> {
  const walletAddress = address as `0x${string}`;
  const latestBlock = await celoClient.getBlock({ blockTag: "latest" });
  const blocksBack = BigInt(
    Math.round((MIN_STABLE_HOLD_DAYS * 24 * 60 * 60) / CELO_BLOCK_TIME_SECS),
  );
  const historicalBlockNumber =
    latestBlock.number > blocksBack ? latestBlock.number - blocksBack : 0n;

  const currentBalances = await Promise.all(
    SUPPORTED_STABLES.map((token) =>
      celoClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddress],
      }),
    ),
  );

  const currentlyHeld = SUPPORTED_STABLES.filter((_, index) => currentBalances[index] > 0n);
  if (currentlyHeld.length === 0) {
    return {
      ok: false,
      status: 403,
      reason: "no-stable-balance",
      message: "Your wallet must currently hold some cUSD, USDT, or USDC to claim this reward.",
    };
  }

  const historicalBalances = await Promise.all(
    currentlyHeld.map((token) =>
      celoClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddress],
        blockNumber: historicalBlockNumber,
      }),
    ),
  );

  const qualifyingToken = currentlyHeld.find((token, index) => historicalBalances[index] > 0n);
  if (!qualifyingToken) {
    return {
      ok: false,
      status: 403,
      reason: "stable-too-new",
      message: `Your wallet must hold cUSD, USDT, or USDC for at least ${MIN_STABLE_HOLD_DAYS} day before claiming this reward.`,
    };
  }

  return { ok: true, token: qualifyingToken.symbol };
}
