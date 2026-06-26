export const CELO_CHAIN_ID = 42220;
export const CELO_CHAIN_ID_HEX = "0xa4ec";

export const CELO_NETWORK_PARAMS = {
  chainId: CELO_CHAIN_ID_HEX,
  chainName: "Celo Mainnet",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: ["https://forno.celo.org"],
  blockExplorerUrls: ["https://explorer.celo.org"],
};

export const TOKENS = {
  cUSD: {
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as `0x${string}`,
    decimals: 18,
    symbol: "cUSD",
    label: "Celo Dollar (cUSD)",
  },
  USDT: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as `0x${string}`,
    decimals: 6,
    symbol: "USDT",
    label: "Tether (USDT)",
  },
  USDC: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as `0x${string}`,
    decimals: 6,
    symbol: "USDC",
    label: "USD Coin (USDC)",
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;

// ERC-20 transfer(address,uint256) selector + calldata
export function encodeERC20Transfer(to: string, amountWei: bigint): string {
  const paddedTo = to.replace("0x", "").padStart(64, "0");
  const paddedAmount = amountWei.toString(16).padStart(64, "0");
  return `0xa9059cbb${paddedTo}${paddedAmount}`;
}

export function toTokenUnits(amountUsd: number, decimals: number): bigint {
  return BigInt(Math.round(amountUsd * 10 ** decimals));
}

// Parse ERC-20 Transfer log to extract { from, to, value }
export type TransferLog = { from: string; to: string; value: bigint };
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function parseTransferLog(log: {
  topics: string[];
  data: string;
}): TransferLog | null {
  if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;
  const from = "0x" + log.topics[1]?.slice(-40);
  const to = "0x" + log.topics[2]?.slice(-40);
  const value = BigInt(log.data ?? "0x0");
  return { from, to, value };
}
