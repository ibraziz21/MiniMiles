/**
 * Upgrades AkibaDiceGame to V2 on Celo mainnet.
 *
 * Steps:
 *   1. Deploy the new V2 implementation
 *   2. upgradeTo(newImpl) on the proxy
 *   3. initializeV2(stablecoin, treasury)
 *   4. setupUsdTier × 3
 *   5. setMilesTierBonus(30, 100_000)
 *
 * Run:
 *   npx hardhat run scripts/upgradeV2Dice.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY   = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const TREASURY     = "0x7622665217d7FA81Ca06E62C58596d5D38d327B3";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ── 1. Deploy new implementation ────────────────────────────────
  // NOTE: A previous attempt deployed impl at 0x36044E8439290c2B68bd736266253bFFdD831AA5
  // but that binary had a different guard. Redeploying with the correct build.
  console.log("\n[1/5] Deploying V2 implementation…");
  const Factory = await ethers.getContractFactory("AkibaDiceGame");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("     New impl:", newImplAddr);

  // ── 2. upgradeTo via proxy ───────────────────────────────────────
  console.log("\n[2/5] Calling upgradeTo on proxy…");
  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const tx2 = await proxy.upgradeTo(newImplAddr);
  await tx2.wait();
  console.log("     upgradeTo done:", tx2.hash);

  // ── 3. initializeV2 ─────────────────────────────────────────────
  console.log("\n[3/5] Calling initializeV2…");
  const tx3 = await proxy.initializeV2(USDT_ADDRESS, TREASURY);
  await tx3.wait();
  console.log("     initializeV2 done:", tx3.hash);

  // ── 4. USD tiers ────────────────────────────────────────────────
  // setupUsdTier(tierId, entryAmount (6-dec), payoutAmount (6-dec), milesAmount (18-dec))
  console.log("\n[4/5] Configuring USD tiers…");

  const tx4a = await proxy.setupUsdTier(
    250n, 250_000n, 1_000_000n, 100_000_000_000_000_000_000n  // $0.25 → $1 + 100 Miles
  );
  await tx4a.wait();
  console.log("     $0.25 tier:", tx4a.hash);

  const tx4b = await proxy.setupUsdTier(
    500n, 500_000n, 2_000_000n, 200_000_000_000_000_000_000n  // $0.50 → $2 + 200 Miles
  );
  await tx4b.wait();
  console.log("     $0.50 tier:", tx4b.hash);

  const tx4c = await proxy.setupUsdTier(
    1000n, 1_000_000n, 3_000_000n, 300_000_000_000_000_000_000n  // $1.00 → $3 + 300 Miles
  );
  await tx4c.wait();
  console.log("     $1.00 tier:", tx4c.hash);

  // ── 5. 30 Miles bonus ───────────────────────────────────────────
  console.log("\n[5/5] Setting 30 Miles tier bonus…");
  const tx5 = await proxy.setMilesTierBonus(30n, 100_000n); // $0.10 USDT
  await tx5.wait();
  console.log("     setMilesTierBonus done:", tx5.hash);

  // ── Summary ─────────────────────────────────────────────────────
  console.log("\n✓ Upgrade complete.");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", newImplAddr);
  console.log("  USDT:     ", USDT_ADDRESS);
  console.log("  Treasury: ", TREASURY);
  console.log("\nNext: call depositBonusPool(amount) to fund the 30 Miles USDT bonus.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
