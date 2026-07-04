/**
 * Configures the GameCreditVault pack used by Farkle Pro Duel.
 *
 * Defaults:
 *   packId:       1
 *   usdtAmount:   1_000_000  ($1.00 with 6 dp USDT)
 *   creditAmount: 10
 *
 * Run with the GameCreditVault owner key:
 *   npx hardhat run scripts/set-farkle-pro-credit-pack.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const VAULT_ABI = [
  "function owner() external view returns (address)",
  "function creditPacks(uint256 packId) external view returns (uint256, uint256, uint256, bool)",
  "function setCreditPack(uint256 packId, uint256 usdtAmount, uint256 creditAmount, bool active) external",
];

function bigintEnv(name: string, fallback: bigint) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = BigInt(raw);
  if (value < 0n) throw new Error(`${name} must be non-negative`);
  return value;
}

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

  const packId = bigintEnv("FARKLE_PRO_PACK_ID", 1n);
  const usdtAmount = bigintEnv("FARKLE_PRO_PACK_USDT_BASE_UNITS", 1_000_000n);
  const creditAmount = bigintEnv("FARKLE_PRO_PACK_CREDITS", 10n);
  const active = (process.env.FARKLE_PRO_PACK_ACTIVE ?? "true").toLowerCase() !== "false";

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
  const owner = await vault.owner();

  console.log("GameCreditVault:", vaultAddr);
  console.log("Vault owner:    ", owner);
  console.log("Signer:         ", signer.address);
  console.log("Pack:           ", packId.toString());
  console.log("USDT base units:", usdtAmount.toString());
  console.log("Credits:        ", creditAmount.toString());
  console.log("Active:         ", active);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the vault owner. Use ${owner}.`);
  }

  const current = await vault.creditPacks(packId);
  const currentUsdt = BigInt(current[1]);
  const currentCredits = BigInt(current[2]);
  const currentActive = Boolean(current[3]);

  if (currentUsdt === usdtAmount && currentCredits === creditAmount && currentActive === active) {
    console.log("\nCredit pack already matches target config. Nothing to do.");
    return;
  }

  console.log(
    `\nUpdating pack ${packId}: ` +
      `${currentUsdt}/${currentCredits}/${currentActive} -> ${usdtAmount}/${creditAmount}/${active}`,
  );

  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await vault.setCreditPack(packId, usdtAmount, creditAmount, active, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  nonce ${nonce} was stale; retrying with sequencer nonce ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }

  if (!tx) throw new Error("Failed to submit setCreditPack transaction.");

  console.log("  tx:", tx.hash);
  await tx.wait(1);

  const updated = await vault.creditPacks(packId);
  console.log(
    `\nUpdated pack ${updated[0].toString()}: ` +
      `usdt=${updated[1].toString()} credits=${updated[2].toString()} active=${Boolean(updated[3])}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
