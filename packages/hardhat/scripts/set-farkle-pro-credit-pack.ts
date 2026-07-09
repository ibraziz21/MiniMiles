/**
 * Configures the GameCreditVault packs used by Farkle Reward/Pro Duel.
 *
 * Defaults:
 *   pack 0: 1 credit  for 100_000 USDT base units  ($0.10)
 *   pack 1: 5 credits for 500_000 USDT base units  ($0.50)
 *   pack 2: 50 credits for 4_900_000 USDT base units ($4.90)
 *
 * To update only one pack, set FARKLE_PACK_ID, FARKLE_PACK_USDT_BASE_UNITS,
 * FARKLE_PACK_CREDITS, and optionally FARKLE_PACK_ACTIVE.
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

type PackTarget = {
  packId: bigint;
  usdtAmount: bigint;
  creditAmount: bigint;
  active: boolean;
};

function boolEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.toLowerCase() !== "false";
}

function packTargets(): PackTarget[] {
  if (process.env.FARKLE_PACK_ID !== undefined) {
    return [{
      packId:       bigintEnv("FARKLE_PACK_ID", 1n),
      usdtAmount:   bigintEnv("FARKLE_PACK_USDT_BASE_UNITS", 500_000n),
      creditAmount: bigintEnv("FARKLE_PACK_CREDITS", 5n),
      active:       boolEnv("FARKLE_PACK_ACTIVE", true),
    }];
  }

  return [
    { packId: 0n, usdtAmount: 100_000n,   creditAmount: 1n,  active: true },
    { packId: 1n, usdtAmount: 500_000n,   creditAmount: 5n,  active: true },
    { packId: 2n, usdtAmount: 4_900_000n, creditAmount: 50n, active: true },
  ];
}

async function main() {
  const [signer] = await ethers.getSigners();

  const vaultAddr = process.env.GAME_CREDIT_VAULT_ADDRESS ??
    process.env.NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS ??
    "0x31B4cbc6c3508156eCaFD937b36C5Bf68848bcba";

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
  const owner = await vault.owner();
  const targets = packTargets();

  console.log("GameCreditVault:", vaultAddr);
  console.log("Vault owner:    ", owner);
  console.log("Signer:         ", signer.address);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the vault owner. Use ${owner}.`);
  }

  let nonceOverride: number | undefined;

  for (const target of targets) {
    const current = await vault.creditPacks(target.packId);
    const currentUsdt = BigInt(current[1]);
    const currentCredits = BigInt(current[2]);
    const currentActive = Boolean(current[3]);

    console.log(
      `\nPack ${target.packId.toString()}: ` +
        `target usdt=${target.usdtAmount.toString()} credits=${target.creditAmount.toString()} active=${target.active}`,
    );

    if (
      currentUsdt === target.usdtAmount &&
      currentCredits === target.creditAmount &&
      currentActive === target.active
    ) {
      console.log("  already matches target config");
      continue;
    }

    console.log(
      `  updating ${currentUsdt}/${currentCredits}/${currentActive}` +
        ` -> ${target.usdtAmount}/${target.creditAmount}/${target.active}`,
    );

    let tx;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
      try {
        console.log(`  attempt ${attempt}: nonce ${nonce}`);
        tx = await vault.setCreditPack(
          target.packId,
          target.usdtAmount,
          target.creditAmount,
          target.active,
          { nonce },
        );
        nonceOverride = nonce + 1;
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

    const updated = await vault.creditPacks(target.packId);
    console.log(
      `  updated pack ${updated[0].toString()}: ` +
        `usdt=${updated[1].toString()} credits=${updated[2].toString()} active=${Boolean(updated[3])}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
