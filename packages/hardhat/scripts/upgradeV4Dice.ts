/**
 * Upgrades AkibaDiceGame to V4 on Celo mainnet.
 *
 * Fix: requestRoundRandomness now queries Witnet's estimateRandomizeFee at
 * tx.gasprice and forwards only that amount, preventing the
 * "WitOracleTrustableDefault: too much reward" revert that was causing all
 * unresolved-round retries to fail.
 *
 * Run:
 *   npx hardhat run scripts/upgradeV4Dice.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ── 1. Deploy new implementation ────────────────────────────────
  console.log("\n[1/2] Deploying new implementation…");
  const Factory = await ethers.getContractFactory("AkibaDiceGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("     New impl:", newImplAddr);

  // ── 2. Upgrade proxy ─────────────────────────────────────────────
  console.log("\n[2/2] Upgrading proxy…");
  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const txUp = await proxy.upgradeTo(newImplAddr);
  await txUp.wait();
  console.log("     upgradeTo:", txUp.hash);

  console.log("\n✓ Done.");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", newImplAddr);
  console.log("\n  Verify with:");
  console.log(`  npx hardhat verify --network celo ${newImplAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
