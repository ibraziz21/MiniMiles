/**
 * deploy-base-raffle.ts
 *
 * Deploys a fresh MiniRaffle UUPS proxy on Base with correct init args.
 * The previous proxy (0x2a03b234b70d073aEbCaa87B94C2B08fDE4d88b6) was
 * initialized with zero addresses and is unusable.
 *
 * Run:
 *   npx hardhat run scripts/deploy-base-raffle.ts --network base
 */

import { ethers, upgrades } from "hardhat";

// ── Base addresses ────────────────────────────────────────────────────────────
const BASE_MILES_TOKEN = "0xA13e9aC89da47B2c526dA265edF9A781C754dB75"; // AkibaMilesV2
const BASE_USDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const OWNER            = "0xfF8E27c7Fdc48e868E35A1b3614FA6393d235106"; // deployer

// On Base there is only USDC — pass it for both _cUSD and _usdt slots
const INIT_ARGS = [BASE_MILES_TOKEN, BASE_USDC, BASE_USDC, OWNER];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deployer:", signer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  const AkibaRaffle = await ethers.getContractFactory("AkibaRaffle");

  console.log("Deploying AkibaRaffle proxy...");
  const proxy = await upgrades.deployProxy(AkibaRaffle, INIT_ARGS, {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();

  const addr = await proxy.getAddress();
  console.log("✓ AkibaRaffle proxy deployed at:", addr);

  // Verify init
  const counter = await (proxy as any).roundIdCounter();
  const owner   = await (proxy as any).owner();
  const mp      = await (proxy as any).miniPoints();
  console.log("  roundIdCounter:", counter.toString());
  console.log("  owner:", owner);
  console.log("  miniPoints:", mp);
  console.log("\nUpdate in akiba_test:");
  console.log(`  NEXT_PUBLIC_BASE_RAFFLE_ADDRESS=${addr}`);
  console.log(`  chain-config.ts  raffle: "${addr}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
