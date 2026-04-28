/**
 * Grant skill-game contracts as minters on AkibaMilesV2.
 *
 * GameTreasury needs minter rights to pay AkibaMiles rewards.
 * AkibaSkillGames needs minter rights because AkibaMilesV2 burn() is restricted
 * to owner/minters, and startGame() burns the player's entry fee.
 * Run once after deploy-skill-games.ts:
 *   npx hardhat run scripts/set-skill-games-minter.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const MINTER_ABI = [
  "function setMinter(address who, bool enabled) external",
  "function minters(address) external view returns (bool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const milesAddr = process.env.MINIPOINTS_V2_ADDRESS!;
  const treasuryAddr = process.env.GAME_TREASURY_ADDRESS;
  const skillGamesAddr = process.env.SKILL_GAMES_CONTRACT_ADDRESS;

  if (!treasuryAddr) throw new Error("GAME_TREASURY_ADDRESS not set in .env");
  if (!skillGamesAddr) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set in .env");

  const miles = new ethers.Contract(milesAddr, MINTER_ABI, deployer);

  for (const [label, address] of [
    ["GameTreasury", treasuryAddr],
    ["AkibaSkillGames", skillGamesAddr],
  ] as const) {
    const already = await miles.minters(address);
    if (already) {
      console.log(`${label} is already a minter: ${address}`);
      continue;
    }

    console.log(`Granting minter role to ${label} (${address})...`);
    const tx = await miles.setMinter(address, true);
    await tx.wait();
    console.log("Done. Tx:", tx.hash);

    const confirmed = await miles.minters(address);
    console.log(`${label} isMinter confirmed:`, confirmed);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
