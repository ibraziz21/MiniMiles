/**
 * authorize-farkle-ticket-minter.ts
 *
 * Grants the AkibaFarkleTicketManager permission to BURN AkibaMilesV2.
 *
 * Why: AkibaFarkleTicketManager.buyTicketPack() burns 25 AkibaMiles via
 * akibaMiles.burn(msg.sender, milesPerPack). That burn is gated by AkibaMilesV2's
 * `onlyAllowed` modifier (owner OR minters[msg.sender]). The deploy-farkle.ts
 * post-deploy checklist grants the minter role to RewardTreasury but NOT to the
 * ticket manager — so every buyTicketPack() reverts with Unauthorized()
 * (0x82b42900) and nobody can buy Quick Duel tickets.
 *
 * Must be run by the AkibaMilesV2 owner wallet (PRIVATE_KEY in .env).
 *
 * Run:
 *   npx hardhat run scripts/authorize-farkle-ticket-minter.ts \
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

  const milesAddr = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
  const ticketAddr =
    process.env.NEXT_PUBLIC_FARKLE_TICKET_ADDRESS ??
    process.env.FARKLE_TICKET_ADDRESS ??
    "0x96cE861Ff7b454b8a9876d6DFd38f0eA90df250c";

  const miles = new ethers.Contract(milesAddr, MINTER_ABI, signer);

  const owner = await miles.owner();
  console.log("AkibaMilesV2:   ", milesAddr);
  console.log("Ticket manager: ", ticketAddr);
  console.log("Token owner:    ", owner);
  console.log("Signer:         ", signer.address);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the token owner. Use the owner wallet (${owner}).`);
  }

  const already = await miles.minters(ticketAddr);
  if (already) {
    console.log("\nTicket manager is already an authorized minter. Nothing to do.");
    return;
  }

  console.log("\nGranting burn authorization to the ticket manager…");
  let tx;
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signer.address, "pending"));
    try {
      console.log(`  attempt ${attempt}: nonce ${nonce}`);
      tx = await miles.setMinter(ticketAddr, true, { nonce });
      break;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) {
        throw err;
      }

      console.log(`  nonce ${nonce} was stale; retrying with sequencer nonce ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }

  if (!tx) {
    throw new Error("Failed to submit setMinter transaction.");
  }

  console.log("  tx:", tx.hash);
  await tx.wait();

  const confirmed = await miles.minters(ticketAddr);
  console.log(`  minters(${ticketAddr}) = ${confirmed}`);
  console.log("\nDone. buyTicketPack() can now burn AkibaMiles — ticket purchases will work.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
