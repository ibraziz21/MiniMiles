/**
 * Upgrades AkibaDiceGame to V5 on Celo mainnet (Witnet passive/consumer mode).
 *
 * What this does:
 *   1. Deploys a new implementation with the Witnet V3 passive oracle support.
 *   2. Upgrades the proxy via upgradeTo().
 *   3. Calls setupClone() to create a private WitRandomnessV3 clone and register
 *      this contract as the consumer. From this point, Witnet pushes results
 *      via reportRandomness() rather than requiring a separate drawRound() call.
 *
 * Legacy rounds (randomBlock set before this upgrade) continue to resolve via
 * RNG_LEGACY through drawRound() / the existing diceSweeper retry loop.
 *
 * Run:
 *   npx hardhat run scripts/upgradeV5Dice.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY   = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

// WitRandomnessV3 base address on Celo — confirmed with Witnet team.
const WITNET_V3_BASE = "0xC0FFEE6912244068F3151F55AeF20fDe504B6E3a";

// Gas limit forwarded to reportRandomness() by the Witnet oracle callback.
// Must cover _finalizeRoundWithEntropy() including ERC-20 transfers and mints.
const CALLBACK_GAS_LIMIT = 350_000;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);

  // ── 1. Deploy new implementation (or reuse existing) ──────────────
  let newImplAddr = process.env.DICE_IMPL_ADDRESS ?? "";
  if (newImplAddr) {
    console.log("\n[1/3] Reusing existing implementation:", newImplAddr);
  } else {
    console.log("\n[1/3] Deploying new implementation…");
    const Factory = await ethers.getContractFactory("AkibaDiceGame");
    const newImpl  = await Factory.deploy();
    await newImpl.waitForDeployment();
    newImplAddr = await newImpl.getAddress();
    console.log("      New impl:", newImplAddr);
  }

  // ── 2. Upgrade proxy ───────────────────────────────────────────────
  console.log("\n[2/3] Upgrading proxy…");
  const txUp = await proxy.upgradeTo(newImplAddr);
  await txUp.wait();
  console.log("      upgradeTo:", txUp.hash);

  // ── 3. Set up Witnet V3 clone ──────────────────────────────────────
  console.log("\n[3/3] Calling setupClone…");
  console.log("      rngBase:          ", WITNET_V3_BASE);
  console.log("      callbackGasLimit: ", CALLBACK_GAS_LIMIT);

  const txClone = await proxy.setupClone(WITNET_V3_BASE, CALLBACK_GAS_LIMIT);
  await txClone.wait();
  console.log("      setupClone tx:", txClone.hash);

  const cloneAddr = await proxy.rngClone();
  console.log("      rngClone deployed at:", cloneAddr);

  console.log("\n✓ Done.");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", newImplAddr);
  console.log("  rngClone: ", cloneAddr);
  console.log("\n  Verify implementation with:");
  console.log(`  npx hardhat verify --network celo ${newImplAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
