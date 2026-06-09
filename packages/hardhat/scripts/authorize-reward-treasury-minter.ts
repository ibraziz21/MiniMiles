/**
 * authorize-reward-treasury-minter.ts
 *
 * Grants the Farkle RewardTreasury permission to MINT AkibaMilesV2.
 *
 * Why: GameSettlementManager.settleMatch() pays AkibaMiles via
 * RewardTreasury.grantAkibaMilesReward() → akibaMiles.mint(user, amount).
 * mint() is gated by AkibaMilesV2's `onlyAllowed` (owner OR minters[]). The
 * deploy-farkle.ts checklist step 1 was never run, so the treasury is not a
 * minter and on-chain settlement reverts — no rewards are paid.
 *
 * Must be run by the AkibaMilesV2 owner wallet (0x7d63…4403).
 *
 * Run:
 *   npx hardhat run scripts/authorize-reward-treasury-minter.ts \
 *     --config hardhat.farkle.config.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const MINTER_ABI = [
  "function setMinter(address who, bool enabled) external",
  "function minters(address) external view returns (bool)",
  "function owner() external view returns (address)",
];

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

  const milesAddr    = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
  const treasuryAddr = process.env.REWARD_TREASURY_ADDRESS ??
    process.env.NEXT_PUBLIC_REWARD_TREASURY_ADDRESS ??
    "0xe8202306C85C350Ceb41897053d09FA326756e68";

  const miles = new ethers.Contract(milesAddr, MINTER_ABI, signer);

  const owner = await miles.owner();
  console.log("AkibaMilesV2:   ", milesAddr);
  console.log("RewardTreasury: ", treasuryAddr);
  console.log("Token owner:    ", owner);
  console.log("Signer:         ", signer.address);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the token owner. Use the owner wallet (${owner}).`);
  }

  if (await miles.minters(treasuryAddr)) {
    console.log("\nRewardTreasury is already an authorized minter. Nothing to do.");
    return;
  }

  console.log("\nGranting mint authorization to the RewardTreasury…");
  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await miles.setMinter(treasuryAddr, true, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  nonce ${nonce} was stale; retrying with sequencer nonce ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }
  if (!tx) throw new Error("Failed to submit setMinter transaction.");

  console.log("  tx:", tx.hash);
  await tx.wait();

  console.log(`  minters(${treasuryAddr}) = ${await miles.minters(treasuryAddr)}`);
  console.log("\nDone. settleMatch() can now mint AkibaMiles rewards.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
