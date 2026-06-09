/**
 * payout-crackpot-winner.ts
 *
 * Make-good for a CrackPot winner whose on-chain declareWinner() never completed
 * (DB cycle is status=cracked with winner_tx_hash = NULL). If that cycle has
 * since rolled over on-chain, the pot can't be paid via declareWinner anymore, so
 * this mints the owed AkibaMiles directly to the winner via AkibaMilesV2.
 *
 * ⚠️ This MINTS tokens — run once per stuck win. There is no on-chain idempotency.
 *
 * Must be run by the AkibaMilesV2 owner (0x7d63…4403).
 *
 * Env:
 *   CRACKPOT_WINNER   winner address          (default: the known stuck winner)
 *   CRACKPOT_AMOUNT   whole AkibaMiles to mint (default: 210)
 *
 * Run:
 *   PRIVATE_KEY=<owner key for 0x7d63…4403> \
 *   CRACKPOT_WINNER=0x9889eef6885eae316c23bfb594e6e1e92c1abd82 CRACKPOT_AMOUNT=210 \
 *     npx hardhat run scripts/payout-crackpot-winner.ts \
 *     --config hardhat.crackpot.config.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const MILES_ABI = [
  "function mint(address account, uint256 amount) external",
  "function minters(address) external view returns (bool)",
  "function owner() external view returns (address)",
  "function balanceOf(address) external view returns (uint256)",
];

function nextNonceFromError(err: unknown): number | undefined {
  const message =
    err instanceof Error ? `${err.message}\n${err.stack ?? ""}`
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message) : String(err);
  const match = message.match(/next nonce\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const milesAddr = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
  const winner = (process.env.CRACKPOT_WINNER ?? "0x9889eef6885eae316c23bfb594e6e1e92c1abd82");
  const amountWhole = process.env.CRACKPOT_AMOUNT ?? "210";

  if (!ethers.isAddress(winner)) throw new Error(`Invalid CRACKPOT_WINNER: ${winner}`);
  const amount = ethers.parseUnits(amountWhole, 18);

  const miles = new ethers.Contract(milesAddr, MILES_ABI, signer);
  const owner = await miles.owner();
  console.log("AkibaMilesV2:", milesAddr);
  console.log("Winner:      ", winner);
  console.log("Amount:      ", `${amountWhole} Miles`);
  console.log("Token owner: ", owner);
  console.log("Signer:      ", signer.address);

  const canMint = owner.toLowerCase() === signer.address.toLowerCase() || (await miles.minters(signer.address));
  if (!canMint) throw new Error(`Signer can't mint. Use the owner (${owner}) or a registered minter.`);

  const before = await miles.balanceOf(winner);
  console.log(`Winner balance before: ${ethers.formatUnits(before, 18)} Miles`);

  console.log("\nMinting owed CrackPot pot to winner…");
  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await miles.mint(winner, amount, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  nonce ${nonce} stale; retry with ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }
  if (!tx) throw new Error("Failed to submit mint transaction.");

  console.log("  tx:", tx.hash);
  await tx.wait();

  const after = await miles.balanceOf(winner);
  console.log(`Winner balance after:  ${ethers.formatUnits(after, 18)} Miles`);
  console.log("\nDone. Remember to mark the DB cycle's winner_tx_hash so it isn't re-paid.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
