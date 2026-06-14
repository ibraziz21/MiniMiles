/**
 * deploy-daily-quest-claimer-base.ts
 *
 * Deploys DailyQuestClaimer to Base and registers it as a minter on AkibaMilesV2.
 *
 * Run:
 *   npx hardhat run scripts/deploy-daily-quest-claimer-base.ts --network base
 *
 * After running, copy the printed contract address into:
 *   akiba_test/packages/react-app/.env  → BASE_DAILY_QUEST_CLAIMER_ADDRESS=<addr>
 *   MiniMiles/packages/backend/.env     → BASE_DAILY_QUEST_CLAIMER_ADDRESS=<addr>
 */

import { ethers } from "hardhat";

const MILES_TOKEN  = "0xA13e9aC89da47B2c526dA265edF9A781C754dB75"; // AkibaMilesV2 on Base
const QUEST_SIGNER = "0xfF8E27c7Fdc48e868E35A1b3614FA6393d235106"; // deployer wallet

const MILES_ABI = [
  "function setMinter(address who, bool enabled) external",
  "function minters(address) external view returns (bool)",
  "function owner() external view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1. Deploy DailyQuestClaimer
  console.log("\nDeploying DailyQuestClaimer...");
  const Factory = await ethers.getContractFactory("DailyQuestClaimer");
  const claimer = await Factory.deploy(MILES_TOKEN, QUEST_SIGNER);
  await claimer.waitForDeployment();
  const claimerAddress = await claimer.getAddress();
  console.log("DailyQuestClaimer deployed at:", claimerAddress);

  // 2. Register claimer as a minter on AkibaMilesV2
  const miles = new ethers.Contract(MILES_TOKEN, MILES_ABI, deployer);

  const owner = await miles.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn("⚠️  Deployer is not the owner of AkibaMilesV2 — cannot setMinter automatically.");
    console.warn("   Run setMinter manually from the owner account:");
    console.warn(`   miles.setMinter("${claimerAddress}", true)`);
  } else {
    const alreadyMinter = await miles.minters(claimerAddress);
    if (alreadyMinter) {
      console.log("DailyQuestClaimer is already a minter.");
    } else {
      console.log("Registering DailyQuestClaimer as minter on AkibaMilesV2...");
      const tx = await miles.setMinter(claimerAddress, true);
      console.log("tx:", tx.hash);
      await tx.wait(1);
      console.log("✓ Minter set.");
    }
  }

  console.log("\n─────────────────────────────────────────────────");
  console.log("Add to .env files:");
  console.log(`BASE_DAILY_QUEST_CLAIMER_ADDRESS=${claimerAddress}`);
  console.log("─────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
