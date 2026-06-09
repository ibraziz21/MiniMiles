/**
 * enable-farkle-claims.ts
 *
 * Turns on USDT reward-credit withdrawals in the GameCreditVault by calling
 * setClaimEnabled(true). Until this runs, claimRewardCredits() reverts with
 * ClaimDisabled() and Reward Duel winners cannot withdraw their USDT winnings.
 *
 * Reward-credit claims are paid from the vault's own USDT balance (self-funded
 * by credit purchases). This script reports that balance so you can confirm
 * there's enough liquidity before opening claims.
 *
 * Must be run by the GameCreditVault owner (the deployer, 0x42BB…9b7f) — i.e.
 * the default PRIVATE_KEY in this hardhat package's .env.
 *
 * Run:
 *   npx hardhat run scripts/enable-farkle-claims.ts \
 *     --config hardhat.farkle.config.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const VAULT_ABI = [
  "function setClaimEnabled(bool enabled) external",
  "function claimEnabled() external view returns (bool)",
  "function owner() external view returns (address)",
  "function usdt() external view returns (address)",
];
const ERC20_ABI = ["function balanceOf(address) external view returns (uint256)"];

function nextNonceFromError(err: unknown): number | undefined {
  const message =
    err instanceof Error
      ? `${err.message}\n${err.stack ?? ""}`
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err);
  const match = message.match(/next nonce\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function main() {
  const [signer] = await ethers.getSigners();

  const vaultAddr = process.env.GAME_CREDIT_VAULT_ADDRESS ??
    process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
    "0x31B4cbc6c3508156eCaFD937b36C5Bf68848bcba";

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);

  const owner = await vault.owner();
  console.log("GameCreditVault:", vaultAddr);
  console.log("Vault owner:    ", owner);
  console.log("Signer:         ", signer.address);

  const usdtAddr = await vault.usdt();
  const usdt = new ethers.Contract(usdtAddr, ERC20_ABI, signer);
  const usdtBal = await usdt.balanceOf(vaultAddr);
  console.log("Vault USDT bal: ", `$${(Number(usdtBal) / 1e6).toFixed(2)}`);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the vault owner. Use ${owner}.`);
  }

  if (await vault.claimEnabled()) {
    console.log("\nClaims are already enabled. Nothing to do.");
    return;
  }

  console.log("\nEnabling USDT reward-credit claims…");
  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await vault.setClaimEnabled(true, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  nonce ${nonce} was stale; retrying with sequencer nonce ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }
  if (!tx) throw new Error("Failed to submit setClaimEnabled transaction.");

  console.log("  tx:", tx.hash);
  await tx.wait();

  console.log(`  claimEnabled() = ${await vault.claimEnabled()}`);
  console.log("\nDone. Reward Duel winners can now claim USDT via claimRewardCredits().");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
