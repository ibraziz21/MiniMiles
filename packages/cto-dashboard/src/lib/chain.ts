import { createPublicClient, http, formatUnits } from "viem";
import { celo } from "viem/chains";

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

const erc20Abi = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const vaultAbi = [
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const diceAbi = [
  { name: "nextRoundId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalRoundsResolved", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "totalRoundsCreated", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "totalPayoutGlobal", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
] as const;

const treasuryAbi = [
  { name: "availableMiles", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export async function getMilesV2TotalSupply() {
  try {
    const raw = await publicClient.readContract({
      address: process.env.MINIPOINTS_V2_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "totalSupply",
    });
    return parseFloat(formatUnits(raw, 18));
  } catch { return 0; }
}

export async function getVaultOnchainTVL() {
  try {
    const raw = await publicClient.readContract({
      address: process.env.VAULT_CONTRACT_ADDRESS as `0x${string}`,
      abi: vaultAbi,
      functionName: "totalAssets",
    });
    return parseFloat(formatUnits(raw, 6)); // USDT 6 decimals
  } catch { return 0; }
}

export async function getDiceOnchainStats() {
  try {
    const [totalCreated, totalResolved, totalPayout] = await Promise.all([
      publicClient.readContract({ address: process.env.DICE_ADDRESS as `0x${string}`, abi: diceAbi, functionName: "totalRoundsCreated" }),
      publicClient.readContract({ address: process.env.DICE_ADDRESS as `0x${string}`, abi: diceAbi, functionName: "totalRoundsResolved" }),
      publicClient.readContract({ address: process.env.DICE_ADDRESS as `0x${string}`, abi: diceAbi, functionName: "totalPayoutGlobal" }),
    ]);
    return {
      totalCreated: Number(totalCreated),
      totalResolved: Number(totalResolved),
      totalPayoutMiles: parseFloat(formatUnits(totalPayout as bigint, 18)),
    };
  } catch { return { totalCreated: 0, totalResolved: 0, totalPayoutMiles: 0 }; }
}

export async function getGameTreasuryMilesPool() {
  try {
    const raw = await publicClient.readContract({
      address: process.env.GAME_TREASURY_ADDRESS as `0x${string}`,
      abi: treasuryAbi,
      functionName: "availableMiles",
    });
    return parseFloat(formatUnits(raw, 18));
  } catch { return 0; }
}
