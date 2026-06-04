/**
 * Upgrades AkibaDiceGame to commit-reveal randomness.
 *
 * New dice rounds no longer request Witnet randomness. They consume queued house
 * commits, lock a future block when the pot fills, and reveal with the stored
 * secret once that blockhash is available.
 *
 * Run:
 *   npx hardhat run scripts/upgradeV6DiceCommitReveal.ts --network celo
 */

import { ethers } from "hardhat";

const DICE_PROXY =
  process.env.DICE_ADDRESS ?? "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";

const DELAY_BLOCKS = Number(process.env.DICE_RANDOMNESS_DELAY_BLOCKS ?? "20");
const REVEAL_WINDOW_BLOCKS = Number(
  process.env.DICE_REVEAL_WINDOW_BLOCKS ?? "220"
);

function normalizePrivateKey(pk: string): string {
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

function resolveOperator(): string {
  if (process.env.DICE_RANDOMNESS_OPERATOR) {
    return process.env.DICE_RANDOMNESS_OPERATOR;
  }

  if (process.env.CELO_RELAYER_PK) {
    return new ethers.Wallet(
      normalizePrivateKey(process.env.CELO_RELAYER_PK)
    ).address;
  }

  throw new Error(
    "Set DICE_RANDOMNESS_OPERATOR or CELO_RELAYER_PK before running this script"
  );
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const operator = resolveOperator();

  console.log("Deployer: ", deployer.address);
  console.log("Proxy:    ", DICE_PROXY);
  console.log("Operator: ", operator);
  console.log("Delay:    ", DELAY_BLOCKS);
  console.log("Window:   ", REVEAL_WINDOW_BLOCKS);

  const proxy = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);

  let newImplAddr = process.env.DICE_IMPL_ADDRESS ?? "";
  if (newImplAddr) {
    console.log("\n[1/3] Reusing implementation:", newImplAddr);
  } else {
    console.log("\n[1/3] Deploying implementation...");
    const Factory = await ethers.getContractFactory("AkibaDiceGame");
    const newImpl = await Factory.deploy();
    await newImpl.waitForDeployment();
    newImplAddr = await newImpl.getAddress();
    console.log("      New impl:", newImplAddr);
  }

  console.log("\n[2/3] Upgrading proxy...");
  const txUp = await proxy.upgradeTo(newImplAddr);
  await txUp.wait();
  console.log("      upgradeTo:", txUp.hash);

  console.log("\n[3/3] Initializing commit-reveal config...");
  try {
    const txInit = await proxy.initializeV4CommitReveal(
      operator,
      DELAY_BLOCKS,
      REVEAL_WINDOW_BLOCKS
    );
    await txInit.wait();
    console.log("      initializeV4CommitReveal:", txInit.hash);
  } catch (err: any) {
    console.warn(
      "      initializer failed; falling back to direct setters:",
      err?.shortMessage ?? err?.message ?? err
    );

    const txOperator = await proxy.setRandomnessOperator(operator);
    await txOperator.wait();
    console.log("      setRandomnessOperator:", txOperator.hash);

    const txConfig = await proxy.setRandomnessConfig(
      DELAY_BLOCKS,
      REVEAL_WINDOW_BLOCKS
    );
    await txConfig.wait();
    console.log("      setRandomnessConfig:", txConfig.hash);
  }

  console.log("\nDone.");
  console.log("Apply packages/backend/sql/dice_commit_reveal.sql before starting the backend sweeper.");
  console.log(`Verify implementation: npx hardhat verify --network celo ${newImplAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
