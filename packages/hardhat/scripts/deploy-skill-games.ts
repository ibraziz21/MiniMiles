/**
 * Deploy GameTreasury + AkibaSkillGames to Celo mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-skill-games.ts --network celo
 *
 * Required env vars (hardhat/.env):
 *   PRIVATE_KEY              — deployer / owner wallet
 *   MINIPOINTS_V2_ADDRESS    — AkibaMilesV2 token (already deployed)
 *   USDT_ADDRESS             — stable token for payouts (already deployed)
 *   SKILL_GAMES_VERIFIER_PK  — private key of the off-chain verifier wallet
 *                              (derive the address from this and pass it in)
 *
 * After deploy, add to react-app/.env:
 *   NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS=<skillGames.address>
 *   SKILL_GAMES_CONTRACT_ADDRESS=<skillGames.address>
 *   GAME_TREASURY_ADDRESS=<treasury.address>
 *   SKILL_GAMES_VERIFIER_PK=<verifierPrivateKey>
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { Wallet } from "ethers";

dotEnvConfig();

// 5 AkibaMiles (18 decimals) — matches GAME_CONFIGS entryCostMiles
const ENTRY_COST_MILES = ethers.parseUnits("5", 18);
// 35 miles max for rule tap, 20 for memory flip
const MAX_REWARD_RULE_TAP  = ethers.parseUnits("35", 18);
const MAX_REWARD_MEMORY    = ethers.parseUnits("20", 18);
// $0.25 max stable for rule tap elite tier (USDT has 6 decimals on Celo)
const MAX_STABLE_RULE_TAP  = ethers.parseUnits("0.25", 6);
const MAX_STABLE_MEMORY    = 0n;
// 30-minute settlement window
const SETTLEMENT_WINDOW    = 30 * 60;

// Initial miles pool size to fund into the treasury (accounting cap — no token transfer)
const INITIAL_MILES_POOL   = ethers.parseUnits("100000", 18);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CELO");

  const milesToken = process.env.MINIPOINTS_V2_ADDRESS;
  const stableToken = process.env.USDT_ADDRESS;
  const verifierPk = process.env.SKILL_GAMES_VERIFIER_PK;

  if (!milesToken || !stableToken || !verifierPk) {
    throw new Error("Missing MINIPOINTS_V2_ADDRESS, USDT_ADDRESS, or SKILL_GAMES_VERIFIER_PK in .env");
  }

  const verifierAddress = new Wallet(verifierPk).address;
  console.log("Verifier address:", verifierAddress);

  // ── 1. Deploy GameTreasury ─────────────────────────────────────────────────
  console.log("\nDeploying GameTreasury...");
  const Treasury = await ethers.getContractFactory("GameTreasury");
  const treasury = await Treasury.deploy(milesToken, stableToken);
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log("GameTreasury deployed:", treasuryAddr);

  // ── 2. Deploy AkibaSkillGames ─────────────────────────────────────────────
  console.log("\nDeploying AkibaSkillGames...");
  const SkillGames = await ethers.getContractFactory("AkibaSkillGames");
  const skillGames = await SkillGames.deploy(milesToken, treasuryAddr, verifierAddress);
  await skillGames.waitForDeployment();
  const skillGamesAddr = await skillGames.getAddress();
  console.log("AkibaSkillGames deployed:", skillGamesAddr);

  // ── 3. Wire treasury → game contract ──────────────────────────────────────
  console.log("\nSetting game contract on treasury...");
  await (await treasury.setGameContract(skillGamesAddr)).wait();
  console.log("Done.");

  // ── 4. Configure game types ───────────────────────────────────────────────
  // gameType 1 = rule_tap, gameType 2 = memory_flip  (matches chainGameType in config.ts)
  console.log("\nConfiguring game types...");
  await (await skillGames.setSupportedGameConfig(
    1, true, ENTRY_COST_MILES, MAX_REWARD_RULE_TAP, MAX_STABLE_RULE_TAP, SETTLEMENT_WINDOW
  )).wait();
  console.log("rule_tap (type 1) configured.");

  await (await skillGames.setSupportedGameConfig(
    2, true, ENTRY_COST_MILES, MAX_REWARD_MEMORY, MAX_STABLE_MEMORY, SETTLEMENT_WINDOW
  )).wait();
  console.log("memory_flip (type 2) configured.");

  // ── 5. Fund miles pool (accounting cap — no token transfer needed) ─────────
  console.log("\nFunding miles pool...");
  await (await treasury.fundMiles(INITIAL_MILES_POOL)).wait();
  console.log("Miles pool funded:", ethers.formatUnits(INITIAL_MILES_POOL, 18), "Miles");

  // ── 6. Print summary ──────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("DEPLOYMENT COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("GameTreasury:       ", treasuryAddr);
  console.log("AkibaSkillGames:    ", skillGamesAddr);
  console.log("Verifier address:   ", verifierAddress);
  console.log("\nAdd to react-app/.env:");
  console.log(`NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS=${skillGamesAddr}`);
  console.log(`SKILL_GAMES_CONTRACT_ADDRESS=${skillGamesAddr}`);
  console.log(`GAME_TREASURY_ADDRESS=${treasuryAddr}`);
  console.log(`SKILL_GAMES_VERIFIER_PK=${verifierPk}`);
  console.log("\n⚠️  IMPORTANT: Grant treasury as minter on AkibaMilesV2");
  console.log(`   Call: AkibaMilesV2.setMinter(${treasuryAddr}, true)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
