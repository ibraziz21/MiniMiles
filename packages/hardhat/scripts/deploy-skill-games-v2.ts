/**
 * Deploy AkibaSkillGamesV2 + (optionally reuse existing GameTreasury).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-skill-games-v2.ts --network celo
 *
 * Required .env:
 *   MINIPOINTS_V2_ADDRESS      — AkibaMilesV2 proxy address
 *   USDT_ADDRESS               — USDT token on Celo
 *   SKILL_GAMES_VERIFIER_PK    — private key of verifier/backend wallet
 *   GAME_TREASURY_ADDRESS      — existing GameTreasury (reused; or leave blank to redeploy)
 *
 * After running:
 *   1. Copy SKILL_GAMES_V2_ADDRESS into react-app/.env
 *   2. Run set-skill-games-minter-v2.ts to grant minter role
 *   3. If treasury was reused, run:
 *        GameTreasury.setGameContract(SKILL_GAMES_V2_ADDRESS)
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const GAME_TYPES = [
  { id: 1, name: "rule_tap",     entryCost: 5n, maxReward: 35n,  maxStable: 250_000n, window: 30 * 60 },
  { id: 2, name: "memory_flip",  entryCost: 5n, maxReward: 20n,  maxStable: 0n,       window: 30 * 60 },
];

const E18 = 10n ** 18n;
const E6  = 10n ** 6n;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const milesAddr    = process.env.MINIPOINTS_V2_ADDRESS;
  const usdtAddr     = process.env.USDT_ADDRESS;
  const verifierPK   = process.env.SKILL_GAMES_VERIFIER_PK;
  const existingTreasury = process.env.GAME_TREASURY_ADDRESS;

  if (!milesAddr || !usdtAddr || !verifierPK) {
    throw new Error("Missing MINIPOINTS_V2_ADDRESS, USDT_ADDRESS, or SKILL_GAMES_VERIFIER_PK in .env");
  }

  const verifierWallet = new ethers.Wallet(verifierPK);
  console.log("Verifier address:", verifierWallet.address);

  // ── Deploy or reuse GameTreasury ────────────────────────────────────────────
  let treasuryAddr: string;
  if (existingTreasury) {
    console.log("\nReusing existing GameTreasury:", existingTreasury);
    treasuryAddr = existingTreasury;
  } else {
    console.log("\nDeploying GameTreasury…");
    const Treasury = await ethers.getContractFactory("GameTreasury");
    const treasury = await Treasury.deploy(milesAddr, usdtAddr);
    await treasury.waitForDeployment();
    treasuryAddr = await treasury.getAddress();
    console.log("GameTreasury deployed:", treasuryAddr);
  }

  // ── Deploy AkibaSkillGamesV2 ────────────────────────────────────────────────
  console.log("\nDeploying AkibaSkillGamesV2…");
  const SkillGames = await ethers.getContractFactory("AkibaSkillGamesV2");
  const skillGames = await SkillGames.deploy(milesAddr, treasuryAddr, verifierWallet.address);
  await skillGames.waitForDeployment();
  const skillGamesAddr = await skillGames.getAddress();
  console.log("AkibaSkillGamesV2 deployed:", skillGamesAddr);

  // ── Wire treasury → new contract ────────────────────────────────────────────
  console.log("\nPointing GameTreasury at AkibaSkillGamesV2…");
  const treasuryAbi = ["function setGameContract(address) external"];
  const treasury = new ethers.Contract(treasuryAddr, treasuryAbi, deployer);
  const tx1 = await treasury.setGameContract(skillGamesAddr);
  await tx1.wait();
  console.log("setGameContract done. Tx:", tx1.hash);

  // ── Configure game types ─────────────────────────────────────────────────────
  console.log("\nConfiguring game types…");
  for (const g of GAME_TYPES) {
    const tx = await skillGames.setSupportedGameConfig(
      g.id,
      true,
      g.entryCost * E18,
      g.maxReward * E18,
      g.maxStable,        // already in USDT base units (6 decimals)
      g.window
    );
    await tx.wait();
    console.log(`  Game ${g.id} (${g.name}) configured. Tx: ${tx.hash}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n─── Deployed addresses ───────────────────────────────────────────");
  console.log("GAME_TREASURY_ADDRESS=", treasuryAddr);
  console.log("NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS=", skillGamesAddr);
  console.log("SKILL_GAMES_CONTRACT_ADDRESS=", skillGamesAddr);
  console.log("\nNext steps:");
  console.log("  1. npx hardhat run scripts/set-skill-games-minter-v2.ts --network celo");
  console.log("  2. Update react-app/.env with SKILL_GAMES_CONTRACT_ADDRESS=", skillGamesAddr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
