/**
 * Grant minter role on AkibaMilesV2 to GameTreasury and AkibaSkillGamesV2.
 *
 * Run after deploy-skill-games-v2.ts:
 *   npx hardhat run scripts/set-skill-games-minter-v2.ts --network celo
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
  const milesAddr      = process.env.MINIPOINTS_V2_ADDRESS!;
  const treasuryAddr   = process.env.GAME_TREASURY_ADDRESS;
  const skillGamesAddr = process.env.SKILL_GAMES_CONTRACT_ADDRESS;

  if (!treasuryAddr)   throw new Error("GAME_TREASURY_ADDRESS not set");
  if (!skillGamesAddr) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set");

  const miles = new ethers.Contract(milesAddr, MINTER_ABI, deployer);

  for (const [label, address] of [
    ["GameTreasury",       treasuryAddr],
    ["AkibaSkillGamesV2",  skillGamesAddr],
  ] as const) {
    const already = await miles.minters(address);
    if (already) {
      console.log(`${label} already a minter: ${address}`);
      continue;
    }
    console.log(`Granting minter to ${label} (${address})…`);
    const tx = await miles.setMinter(address, true);
    await tx.wait();
    const confirmed = await miles.minters(address);
    console.log(`Done. Tx: ${tx.hash}  confirmed: ${confirmed}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
