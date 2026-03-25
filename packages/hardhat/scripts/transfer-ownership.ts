import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const DICE_PROXY = "0xf77e7395Aa5c89BcC8d6e23F67a9c7914AB9702a";
const NEW_OWNER     = "0x7d63d39D88Eb0d8754111c706136f5Bd7Ae84403";
const MAX_RETRIES   = 8;
const RETRY_DELAY   = 5000;

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
        msg.includes("transaction underpriced") ||
        msg.includes("intrinsic gas too low");
      if (retryable && attempt < MAX_RETRIES) {
        console.warn(`  [${label}] attempt ${attempt} failed: ${msg.split("\n")[0]}`);
        console.warn(`  Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const dice = await ethers.getContractAt("AkibaDiceGame", DICE_PROXY);

  const diceOwner = await dice.owner();
  console.log("Dice owner:", diceOwner);

  if (diceOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not dice owner. Owner is ${diceOwner}`);
  }

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice
    ? (feeData.gasPrice * 130n) / 100n
    : ethers.parseUnits("5", "gwei");
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  console.log(`Transferring dice ownership to ${NEW_OWNER}...`);
  const tx = await withRetry("dice.transferOwnership", () =>
    dice.transferOwnership(NEW_OWNER, { gasPrice })
  );
  await tx.wait();
  console.log("✅ Dice new owner:", await dice.owner());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
