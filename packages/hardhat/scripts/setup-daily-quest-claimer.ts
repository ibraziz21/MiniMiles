/**
 * setup-daily-quest-claimer.ts
 *
 * One-shot setup script:
 *   1. Deploys DailyQuestClaimer.sol to Celo mainnet
 *   2. Registers the deployed contract as a minter on AkibaMilesV2
 *   3. Prints the env vars to add to packages/react-app/.env
 *
 * Reads the OWNER private key from packages/react-app/.env — this must be
 * the address that owns AkibaMilesV2 (0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403).
 *
 * Run: npx ts-node --project tsconfig.json scripts/setup-daily-quest-claimer.ts
 */

import { readFileSync } from "fs";
import { resolve }      from "path";
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount }  from "viem/accounts";
import { celo }                 from "viem/chains";

// ── Load env files ────────────────────────────────────────────────────────────

function loadEnv(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const lines = readFileSync(filePath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
  } catch {
    // file may not exist
  }
  return env;
}

// The owner key lives in the react-app env (same wallet as CRACKPOT_RELAYER_ADDRESS)
const reactEnv = loadEnv(resolve(__dirname, "../../react-app/.env"));

const OWNER_PK = reactEnv.PRIVATE_KEY;
const MILES_TOKEN = (
  reactEnv.MINIPOINTS_V2_ADDRESS ??
  "0xab93400000751fc17918940C202A66066885d628"
) as `0x${string}`;
const CELO_RPC = reactEnv.CELO_RPC_URL ?? "https://forno.celo.org";

if (!OWNER_PK) {
  console.error("ERROR: PRIVATE_KEY not found in packages/react-app/.env");
  process.exit(1);
}

// ── Load compiled artifact ─────────────────────────────────────────────────────

// Compile first: npx hardhat compile
let artifact: { abi: any[]; bytecode: string };
try {
  artifact = require("../artifacts-minimal/contracts-new/DailyQuestClaimer.sol/DailyQuestClaimer.json");
} catch {
  console.error("ERROR: Artifact not found. Run `npx hardhat compile` first.");
  process.exit(1);
}

// ── AkibaMilesV2 ABI (just what we need) ──────────────────────────────────────

const milesAbi = parseAbi([
  "function setMinter(address who, bool enabled) external",
  "function minters(address) external view returns (bool)",
  "function owner() external view returns (address)",
]);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pkHex = (OWNER_PK.startsWith("0x") ? OWNER_PK : `0x${OWNER_PK}`) as `0x${string}`;
  const account = privateKeyToAccount(pkHex);

  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const walletClient = createWalletClient({ account, chain: celo, transport: http(CELO_RPC) });

  console.log("\n=== DailyQuestClaimer Setup ===");
  console.log("Deployer/signer:", account.address);
  console.log("AkibaMilesV2:  ", MILES_TOKEN);

  // Verify the deployer is the Miles token owner
  const owner = await publicClient.readContract({
    address: MILES_TOKEN,
    abi: milesAbi,
    functionName: "owner",
  });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`\nERROR: AkibaMilesV2 owner is ${owner}, but deploying with ${account.address}.`);
    console.error("setMinter will fail. Use the owner key.");
    process.exit(1);
  }
  console.log("Owner check: ✓\n");

  // ── Deploy ─────────────────────────────────────────────────────────────────
  console.log("Deploying DailyQuestClaimer...");

  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [MILES_TOKEN, account.address], // signer = same as deployer (owner key)
    account,
    chain: celo,
  });

  console.log("Deploy tx:", deployHash);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash, confirmations: 2 });
  const claimerAddress = receipt.contractAddress!;
  console.log("DailyQuestClaimer deployed:", claimerAddress, "\n");

  // ── Register as minter ─────────────────────────────────────────────────────
  console.log("Registering as minter on AkibaMilesV2...");

  const minterHash = await walletClient.writeContract({
    address: MILES_TOKEN,
    abi: milesAbi,
    functionName: "setMinter",
    args: [claimerAddress, true],
    account,
    chain: celo,
  });

  console.log("setMinter tx:", minterHash);
  await publicClient.waitForTransactionReceipt({ hash: minterHash, confirmations: 2 });

  // Verify
  const isMinter = await publicClient.readContract({
    address: MILES_TOKEN,
    abi: milesAbi,
    functionName: "minters",
    args: [claimerAddress],
  });
  console.log("Minter registered:", isMinter, "\n");

  // ── Print env vars ─────────────────────────────────────────────────────────
  console.log("=== Add to packages/react-app/.env ===");
  console.log(`DAILY_QUEST_CLAIMER_ADDRESS=${claimerAddress}`);
  console.log(`QUEST_VOUCHER_SIGNER_KEY=   (same as PRIVATE_KEY — already set)`);
  console.log("\n=== Done ===\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
