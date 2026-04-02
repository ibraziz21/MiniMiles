/**
 * Upgrades AkibaDiceGame to V3b on Celo mainnet, then migrates pre-V2 rounds.
 *
 * Root cause: V2 inserted config-snapshot fields before playerByNumber in
 * DiceRound, shifting the mapping from struct-slot 5 → slot 10.  Player data
 * written by V1 rounds lives at slot-5 positions; V2+ reads slot-10 → all
 * zero addresses → empty number buttons even when filledSlots > 0.
 *
 * This script:
 *   1. Deploys a new implementation with migrateV1PlayerSlots()
 *   2. Upgrades the proxy
 *   3. Discovers active rounds for tiers 10 & 20 and migrates each
 *
 * Run:
 *   npx hardhat run scripts/upgradeV3bDice.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY   = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";
const MILES_TIERS  = [10, 20, 30] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // ── 1. Deploy new implementation ────────────────────────────────
  console.log("\n[1/3] Deploying new implementation…");
  const Factory = await ethers.getContractFactory("AkibaDiceGame");
  const newImpl  = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("     New impl:", newImplAddr);

  // ── 2. Upgrade proxy ─────────────────────────────────────────────
  console.log("\n[2/3] Upgrading proxy…");
  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);
  const txUp  = await proxy.upgradeTo(newImplAddr);
  await txUp.wait();
  console.log("     upgradeTo:", txUp.hash);

  // ── 3. Migrate pre-V2 rounds ──────────────────────────────────────
  console.log("\n[3/3] Migrating pre-V2 player slots…");

  for (const tier of MILES_TIERS) {
    const roundId: bigint = await proxy.getActiveRoundId(BigInt(tier));
    if (roundId === 0n) {
      console.log(`     Tier ${tier}: no active round, skipping.`);
      continue;
    }

    // Check if it's a pre-V2 round (miniPointsSnap == address(0))
    // We detect this by calling a view that would tell us; simplest is to
    // try calling migrateV1PlayerSlots and catch the "not a pre-V2 round" revert.
    console.log(`     Tier ${tier}: active round #${roundId} — attempting migration…`);
    try {
      const txMig = await proxy.migrateV1PlayerSlots(roundId);
      await txMig.wait();
      console.log(`     Tier ${tier}: migrated ✓  (${txMig.hash})`);
    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? String(err);
      if (msg.includes("not a pre-V2 round")) {
        console.log(`     Tier ${tier}: V2 round, no migration needed.`);
      } else if (msg.includes("already resolved")) {
        console.log(`     Tier ${tier}: round already resolved, skipping.`);
      } else {
        console.error(`     Tier ${tier}: unexpected error —`, msg);
      }
    }
  }

  console.log("\n✓ Done.");
  console.log("  Proxy:    ", DICE_PROXY);
  console.log("  New impl: ", newImplAddr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
