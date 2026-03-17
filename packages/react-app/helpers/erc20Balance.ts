import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { celo } from "viem/chains";

const publicClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

export async function getErc20Balance(params: {
  userAddress: string;
  tokenAddress: `0x${string}`;
  decimals?: number;
}): Promise<number> {
  const { userAddress, tokenAddress, decimals = 18 } = params;

  const raw = (await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [userAddress as `0x${string}`],
  })) as bigint;

  return Number(formatUnits(raw, decimals));
}

export async function userErc20BalanceAtLeast(params: {
  userAddress: string;
  tokenAddress: `0x${string}`;
  minAmount: number;
  decimals?: number;
}): Promise<boolean> {
  const balance = await getErc20Balance(params);
  return balance >= params.minAmount;
}
