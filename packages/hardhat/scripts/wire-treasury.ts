/**
 * Wire GameTreasury to the current skill-games contract.
 * Usage: npx hardhat run scripts/wire-treasury.ts --network celo
 */

import hre from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

async function main() {
  const treasuryAddr = process.env.GAME_TREASURY_ADDRESS;
  const skillGamesAddr = process.env.SKILL_GAMES_CONTRACT_ADDRESS;

  if (!treasuryAddr || !skillGamesAddr) {
    throw new Error("GAME_TREASURY_ADDRESS and SKILL_GAMES_CONTRACT_ADDRESS must be set");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasuryAddr);
  console.log("SkillGames:", skillGamesAddr);

  const treasury = new hre.ethers.Contract(
    treasuryAddr,
    ["function setGameContract(address)", "function gameContract() view returns (address)", "function owner() view returns (address)"],
    deployer
  );

  const owner = await treasury.owner();
  console.log("Treasury owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not the treasury owner ${owner}`);
  }

  const current = await treasury.gameContract();
  console.log("Current gameContract:", current);

  if (current.toLowerCase() === skillGamesAddr.toLowerCase()) {
    console.log("Already wired correctly, nothing to do.");
    return;
  }

  const tx = await treasury.setGameContract(skillGamesAddr);
  console.log("setGameContract tx:", tx.hash);
  await tx.wait(1);
  console.log("Done. GameTreasury now points to", skillGamesAddr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
