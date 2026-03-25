/**
 * upgrade-contracts.ts
 *
 * Explicitly deploys a fresh implementation contract, then points the
 * UUPS proxy at it via upgradeTo(). No plugin caching involved.
 *
 * .env required:
 *   RAFFLE_V6_ADDRESS=   (proxy — skip if already done)
 *   DICE_ADDRESS=        (proxy)
 *
 * Run:
 *   npx hardhat run scripts/upgrade-contracts.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 4000;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const retryable =
        msg.includes("replacement transaction underpriced") ||
        msg.includes("nonce too low") ||
        msg.includes("already known") ||
        msg.includes("transaction underpriced");
      if (retryable && attempt < MAX_RETRIES) {
        console.warn(`  [${label}] attempt ${attempt} failed (${msg.split("\n")[0]}), retrying in ${RETRY_DELAY_MS}ms…`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts`);
}

async function deployAndUpgrade(
  contractName: string,
  proxyAddr: string,
  gasPrice: bigint
) {
  const Factory = await ethers.getContractFactory(contractName);

  // Step 1: deploy fresh implementation (plain contract, not a proxy)
  console.log(`  Deploying new ${contractName} implementation...`);
  const newImpl: any = await withRetry(`${contractName} deploy impl`, () =>
    Factory.deploy({ gasPrice })
  );
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log(`  New implementation: ${newImplAddr}`);

  // Step 2: point the proxy at the new implementation via upgradeTo()
  console.log(`  Calling upgradeTo on proxy ${proxyAddr}...`);
  const proxy = await ethers.getContractAt(contractName, proxyAddr);
  const tx: any = await withRetry(`${contractName} upgradeTo`, () =>
    proxy.upgradeTo(newImplAddr, { gasPrice })
  );
  await tx.wait();
  console.log(`  ✅ ${contractName} proxy now points to ${newImplAddr}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading with:", deployer.address);

  const raffleAddr = process.env.RAFFLE_V6_ADDRESS;
  const diceAddr   = process.env.DICE_ADDRESS;

  // Bump gas price 30% above base
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice
    ? (feeData.gasPrice * 130n) / 100n
    : ethers.parseUnits("5", "gwei");
  console.log("Using gasPrice:", ethers.formatUnits(gasPrice, "gwei"), "gwei\n");

  if (raffleAddr) {
    console.log("=== AkibaRaffleV6 ===");
    await deployAndUpgrade("AkibaRaffleV6", raffleAddr, gasPrice);
  } else {
    console.log("RAFFLE_V6_ADDRESS not set — skipping RaffleV6.");
  }

  if (diceAddr) {
    console.log("\n=== AkibaDiceGame ===");
    await deployAndUpgrade("AkibaDiceGame", diceAddr, gasPrice);
  } else {
    console.log("DICE_ADDRESS not set — skipping Dice.");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
