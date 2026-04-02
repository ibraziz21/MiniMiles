/**
 * Upgrades AkibaDiceGame to V3 on Celo mainnet.
 *
 * V3 is a bug-fix only upgrade — no new initializer, no tier reconfiguration.
 * It adds fallback logic so pre-V2 rounds (tiers 10 & 20) use live contract
 * values instead of zero snapshots, restoring correct burns and payouts.
 *
 * Run:
 *   npx hardhat run scripts/upgradeV3Dice.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ── 1. Deploy new V3 implementation ─────────────────────────────
  console.log("\n[1/2] Deploying V3 implementation…");
  const Factory = await ethers.getContractFactory("AkibaDiceGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("     New impl:", newImplAddr);

  // ── 2. upgradeTo via proxy ───────────────────────────────────────
  console.log("\n[2/2] Calling upgradeTo on proxy…");
  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const tx = await proxy.upgradeTo(newImplAddr);
  await tx.wait();
  console.log("     upgradeTo done:", tx.hash);

  console.log("\n✓ V3 upgrade complete.");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", newImplAddr);
  console.log("\nPre-V2 rounds for tiers 10 & 20 will now burn/mint correctly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
