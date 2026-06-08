/**
 * Deploy Farkle PvP contract suite (UUPS upgradeable).
 *
 * Deploys 5 contracts as ERC1967 proxies in dependency order:
 *   1. GameRegistry
 *   2. AkibaFarkleTicketManager
 *   3. GameCreditVault
 *   4. RewardTreasury
 *   5. GameSettlementManager
 *
 * Then wires them together and registers the FARKLE game + both modes.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-farkle.ts --network celo
 *   npx hardhat run scripts/deploy-farkle.ts --network celoSepolia   (testnet)
 *
 * Required .env:
 *   MINIPOINTS_V2_ADDRESS      AkibaMilesV2 proxy (for ticket burns + rewards)
 *   USDT_ADDRESS               USDT token on Celo (6 decimals)
 *   FARKLE_RESOLVER_ADDRESS    Backend signer wallet address (authorized to settle matches)
 *                              If omitted, deployer address is used (dev only)
 *
 * Optional .env:
 *   GAME_REGISTRY_ADDRESS      Skip re-deploy; use existing
 *   FARKLE_TICKET_ADDRESS      Skip re-deploy; use existing
 *   GAME_CREDIT_VAULT_ADDRESS  Skip re-deploy; use existing
 *   REWARD_TREASURY_ADDRESS    Skip re-deploy; use existing
 *
 * After deploy:
 *   1. Grant AkibaMiles minter role to RewardTreasury proxy
 *   2. Fund RewardTreasury with USDT for reward payouts (Reward Duel)
 *   3. Add proxy addresses to react-app .env
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotEnvConfig();

// ── Helpers ───────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

async function deployProxy(
  deployer: any,
  contractName: string,
  initData: string,
): Promise<string> {
  // Deploy implementation
  console.log(`\n  Deploying ${contractName} implementation…`);
  const Factory = await ethers.getContractFactory(contractName);
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`  Implementation: ${implAddr}`);

  // Deploy ERC1967 proxy
  const proxyArtifactPath = path.resolve(
    __dirname,
    "../node_modules/.pnpm/@openzeppelin+contracts@4.8.3/node_modules/@openzeppelin/contracts/build/contracts/ERC1967Proxy.json",
  );
  const artifact = JSON.parse(fs.readFileSync(proxyArtifactPath, "utf8"));
  const ProxyFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const proxy = await ProxyFactory.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`  Proxy:          ${proxyAddr}`);
  return proxyAddr;
}

// ── Game / mode IDs (keccak256 of the string, matching what we'll use in the DB) ──

const GAME_ID_FARKLE       = ethers.keccak256(ethers.toUtf8Bytes("FARKLE"));
const MODE_ID_QUICK        = ethers.keccak256(ethers.toUtf8Bytes("FARKLE_QUICK_1500_AKIBA"));
const MODE_ID_REWARD       = ethers.keccak256(ethers.toUtf8Bytes("FARKLE_REWARD_3000_USDT"));

// EntryCurrency enum: { NONE=0, AKIBA_TICKET=1, GAME_CREDIT=2, USDT=3 }
// RewardType enum:    { NONE=0, AKIBAMILES=1, REWARD_CREDIT=2, MIXED=3 }

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" Farkle PvP Suite — UUPS Deploy");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Deployer :", deployer.address);

  const milesAddr    = required("MINIPOINTS_V2_ADDRESS");
  const usdtAddr     = required("USDT_ADDRESS");
  const resolverAddr = optional("FARKLE_RESOLVER_ADDRESS", deployer.address);

  console.log("Miles    :", milesAddr);
  console.log("USDT     :", usdtAddr);
  console.log("Resolver :", resolverAddr);

  // ── 1. GameRegistry ──────────────────────────────────────────────────────────

  let registryAddr = process.env.GAME_REGISTRY_ADDRESS ?? "";
  if (registryAddr) {
    console.log("\n[1] Reusing GameRegistry:", registryAddr);
  } else {
    console.log("\n[1] Deploying GameRegistry…");
    const Factory   = await ethers.getContractFactory("GameRegistry");
    const initData  = Factory.interface.encodeFunctionData("initialize", []);
    registryAddr    = await deployProxy(deployer, "GameRegistry", initData);
  }

  // ── 2. AkibaFarkleTicketManager ──────────────────────────────────────────────

  let ticketAddr = process.env.FARKLE_TICKET_ADDRESS ?? "";
  if (ticketAddr) {
    console.log("\n[2] Reusing AkibaFarkleTicketManager:", ticketAddr);
  } else {
    console.log("\n[2] Deploying AkibaFarkleTicketManager…");
    const Factory  = await ethers.getContractFactory("AkibaFarkleTicketManager");
    const initData = Factory.interface.encodeFunctionData("initialize", [milesAddr]);
    ticketAddr     = await deployProxy(deployer, "AkibaFarkleTicketManager", initData);
  }

  // ── 3. GameCreditVault ───────────────────────────────────────────────────────

  let vaultAddr = process.env.GAME_CREDIT_VAULT_ADDRESS ?? "";
  if (vaultAddr) {
    console.log("\n[3] Reusing GameCreditVault:", vaultAddr);
  } else {
    console.log("\n[3] Deploying GameCreditVault…");
    const Factory  = await ethers.getContractFactory("GameCreditVault");
    const initData = Factory.interface.encodeFunctionData("initialize", [usdtAddr]);
    vaultAddr      = await deployProxy(deployer, "GameCreditVault", initData);
  }

  // ── 4. RewardTreasury ────────────────────────────────────────────────────────

  let treasuryAddr = process.env.REWARD_TREASURY_ADDRESS ?? "";
  if (treasuryAddr) {
    console.log("\n[4] Reusing RewardTreasury:", treasuryAddr);
  } else {
    console.log("\n[4] Deploying RewardTreasury…");
    const Factory  = await ethers.getContractFactory("RewardTreasury");
    const initData = Factory.interface.encodeFunctionData("initialize", [milesAddr, usdtAddr]);
    treasuryAddr   = await deployProxy(deployer, "RewardTreasury", initData);
  }

  // ── 5. GameSettlementManager ─────────────────────────────────────────────────

  console.log("\n[5] Deploying GameSettlementManager…");
  const SMFactory  = await ethers.getContractFactory("GameSettlementManager");
  const smInitData = SMFactory.interface.encodeFunctionData("initialize", [registryAddr]);
  const smAddr     = await deployProxy(deployer, "GameSettlementManager", smInitData);

  // ── 6. Wire contracts ─────────────────────────────────────────────────────────

  console.log("\n[6] Wiring contracts…");

  const ticketContract   = await ethers.getContractAt("AkibaFarkleTicketManager", ticketAddr);
  const vaultContract    = await ethers.getContractAt("GameCreditVault",           vaultAddr);
  const treasuryContract = await ethers.getContractAt("RewardTreasury",            treasuryAddr);
  const smContract       = await ethers.getContractAt("GameSettlementManager",     smAddr);

  // Set settlement manager on ticket/vault/treasury
  console.log("  TicketManager.setSettlementManager…");
  await (await ticketContract.setSettlementManager(smAddr)).wait();

  console.log("  CreditVault.setSettlementManager…");
  await (await vaultContract.setSettlementManager(smAddr)).wait();

  console.log("  RewardTreasury.setSettlementManager…");
  await (await treasuryContract.setSettlementManager(smAddr)).wait();

  // Set all sub-contracts on settlement manager
  console.log("  SettlementManager.setContracts…");
  await (await smContract.setContracts(ticketAddr, vaultAddr, treasuryAddr)).wait();

  // Authorize backend resolver
  console.log("  SettlementManager.setAuthorizedResolver…");
  await (await smContract.setAuthorizedResolver(resolverAddr, true)).wait();

  // ── 7. Register Farkle game + modes ─────────────────────────────────────────

  console.log("\n[7] Registering Farkle game + modes in GameRegistry…");
  const registry = await ethers.getContractAt("GameRegistry", registryAddr);

  console.log("  registerGame(FARKLE)…");
  await (await registry.registerGame(GAME_ID_FARKLE, "Farkle Duel", smAddr)).wait();

  console.log("  registerGameMode(FARKLE_QUICK_1500_AKIBA)…");
  await (await registry.registerGameMode(
    MODE_ID_QUICK,
    GAME_ID_FARKLE,
    "Farkle Quick Duel",
    2,           // playerCount
    1500,        // targetScore
    1,           // EntryCurrency.AKIBA_TICKET
    1,           // entryAmount (1 ticket)
    1,           // RewardType.AKIBAMILES
  )).wait();

  console.log("  registerGameMode(FARKLE_REWARD_3000_USDT)…");
  await (await registry.registerGameMode(
    MODE_ID_REWARD,
    GAME_ID_FARKLE,
    "Farkle Reward Duel",
    2,           // playerCount
    3000,        // targetScore
    2,           // EntryCurrency.GAME_CREDIT
    1,           // entryAmount (1 credit)
    3,           // RewardType.MIXED (miles + reward credit)
  )).wait();

  // ── 8. Summary ───────────────────────────────────────────────────────────────

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" ✅  Deployed Addresses");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  GameRegistry             :", registryAddr);
  console.log("  AkibaFarkleTicketManager :", ticketAddr);
  console.log("  GameCreditVault          :", vaultAddr);
  console.log("  RewardTreasury           :", treasuryAddr);
  console.log("  GameSettlementManager    :", smAddr);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" Post-deploy checklist");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n1. Grant AkibaMiles minter role to RewardTreasury:`);
  console.log(`     akibaMiles.setMinter("${treasuryAddr}", true)`);
  console.log(`\n2. Fund RewardTreasury with USDT for Reward Duel prizes:`);
  console.log(`     usdt.transfer("${treasuryAddr}", <amount>)`);
  console.log(`\n3. Add to react-app .env:`);
  console.log(`     NEXT_PUBLIC_GAME_REGISTRY_ADDRESS=${registryAddr}`);
  console.log(`     NEXT_PUBLIC_FARKLE_TICKET_ADDRESS=${ticketAddr}`);
  console.log(`     NEXT_PUBLIC_GAME_CREDIT_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`     NEXT_PUBLIC_REWARD_TREASURY_ADDRESS=${treasuryAddr}`);
  console.log(`     NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=${smAddr}`);
  console.log(`\n4. Verify contracts on Celoscan:`);
  console.log(`     npx hardhat verify --network celo <impl_address>`);
  console.log(`     (implementation addresses logged above as "Implementation: 0x…")`);
  console.log(`\n5. Enable USDT reward credit claims (after compliance check):`);
  console.log(`     gameCreditVault.setClaimEnabled(true)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
