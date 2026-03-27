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
