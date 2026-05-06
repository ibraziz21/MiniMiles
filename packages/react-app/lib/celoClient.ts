import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

export const celoClient = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

/**
 * Returns the total number of transactions sent from an address on Celo.
 * Throws on RPC failure — callers must decide whether to allow or deny.
 */
export async function getCeloTxCount(address: string): Promise<number> {
  return celoClient.getTransactionCount({ address: address as `0x${string}` });
}

// Celo produces a block roughly every 5 seconds.
const CELO_BLOCK_TIME_SECS = 5;

/**
 * Returns true if the wallet had at least one on-chain transaction
 * at least `minDays` days ago — i.e. the wallet is older than minDays.
 *
 * Strategy: look up the nonce (tx count) at the block that was mined
 * ~minDays ago. If it was already > 0 then, the wallet pre-dates that block.
 *
 * Throws on RPC failure — callers must hard-fail.
 */
export async function isWalletOldEnough(
  address: string,
  minDays: number,
): Promise<boolean> {
  const latest = await celoClient.getBlock({ blockTag: "latest" });
  const blocksBack = BigInt(Math.round((minDays * 24 * 60 * 60) / CELO_BLOCK_TIME_SECS));
  const historicalBlock =
    latest.number > blocksBack ? latest.number - blocksBack : 0n;

  const countAtHistoricalBlock = await celoClient.getTransactionCount({
    address: address as `0x${string}`,
    blockNumber: historicalBlock,
  });

  return countAtHistoricalBlock > 0;
}

// Shared gate used by partner quests, referrals, and profile milestones.
const WALLET_MIN_TXS = Number(process.env.WALLET_MIN_TXS ?? "10");
const WALLET_MIN_AGE_DAYS = Number(process.env.WALLET_MIN_AGE_DAYS ?? "5");

/**
 * Checks that a wallet meets the minimum activity requirements:
 *   - at least WALLET_MIN_TXS total transactions
 *   - wallet had activity at least WALLET_MIN_AGE_DAYS ago
 *
 * Returns `{ ok: true }` on pass, `{ ok: false, message, status }` on fail.
 * Throws on RPC error — callers should return 503.
 */
export async function checkWalletHistory(address: string): Promise<
  | { ok: true }
  | { ok: false; message: string; status: 403 }
> {
  const [txCount, oldEnough] = await Promise.all([
    getCeloTxCount(address),
    isWalletOldEnough(address, WALLET_MIN_AGE_DAYS),
  ]);

  if (txCount < WALLET_MIN_TXS) {
    return {
      ok: false,
      status: 403,
      message: `Your wallet needs at least ${WALLET_MIN_TXS} transactions on Celo to claim this reward.`,
    };
  }
  if (!oldEnough) {
    return {
      ok: false,
      status: 403,
      message: `Your wallet must be at least ${WALLET_MIN_AGE_DAYS} days old to claim this reward.`,
    };
  }
  return { ok: true };
}
