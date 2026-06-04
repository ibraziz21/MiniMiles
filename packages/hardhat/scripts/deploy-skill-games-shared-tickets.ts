/**
 * Deploy shared-ticket Skill Games and wire it to the existing GameTreasury.
 *
 * Uses raw Hardhat provider calls to avoid the local ethers-v5/v6 plugin mismatch.
 *
 * Usage:
 *   npx hardhat run --config hardhat.skill-games.config.ts scripts/deploy-skill-games-shared-tickets.ts --network celo
 */

import hre from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import artifact from "../artifacts-skill-games/contracts/skill-games/AkibaSkillGamesV2SharedTickets.sol/AkibaSkillGamesV2SharedTickets.json";

dotEnvConfig();

const GAME_TYPES = [
  { id: 1, name: "rule_tap", entryCost: 5n, maxReward: 35n, maxStable: 250_000n, window: 30 * 60 },
  { id: 2, name: "memory_flip", entryCost: 5n, maxReward: 20n, maxStable: 0n, window: 30 * 60 },
];

const E18 = 10n ** 18n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

let nextNonce: number | null = null;

async function sendTx(from: string, to: string | undefined, data: string) {
  if (nextNonce == null) {
    const nonceHex = await hre.network.provider.request({
      method: "eth_getTransactionCount",
      params: [from, "pending"],
    }) as string;
    nextNonce = Number(BigInt(nonceHex));
  }

  let hash: string;
  try {
    hash = await hre.network.provider.request({
      method: "eth_sendTransaction",
      params: [{ from, ...(to ? { to } : {}), data, nonce: hre.ethers.utils.hexValue(nextNonce) }],
    }) as string;
  } catch (err: any) {
    if (!String(err?.message ?? "").includes("nonce too low")) throw err;
    const nonceHex = await hre.network.provider.request({
      method: "eth_getTransactionCount",
      params: [from, "pending"],
    }) as string;
    nextNonce = Number(BigInt(nonceHex));
    hash = await hre.network.provider.request({
      method: "eth_sendTransaction",
      params: [{ from, ...(to ? { to } : {}), data, nonce: hre.ethers.utils.hexValue(nextNonce) }],
    }) as string;
  }
  nextNonce += 1;

  for (;;) {
    const receipt = await hre.network.provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }) as any;
    if (receipt) return { hash, receipt };
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function main() {
  const [from] = await hre.network.provider.request({
    method: "eth_accounts",
    params: [],
  }) as string[];
  if (!from) throw new Error("No deployer account from Hardhat network config");

  const milesAddr = requireEnv("MINIPOINTS_V2_ADDRESS");
  const treasuryAddr = requireEnv("GAME_TREASURY_ADDRESS");
  const verifierPk = requireEnv("SKILL_GAMES_VERIFIER_PK");
  const verifier = new hre.ethers.Wallet(verifierPk).address;

  const coder = hre.ethers.utils.defaultAbiCoder;
  const iface = new hre.ethers.utils.Interface(artifact.abi);
  const treasuryIface = new hre.ethers.utils.Interface(["function setGameContract(address)"]);
  const milesIface = new hre.ethers.utils.Interface([
    "function minters(address) view returns (bool)",
    "function setMinter(address,bool)",
  ]);

  console.log("Deployer:", from);
  console.log("Treasury:", treasuryAddr);
  console.log("Verifier:", verifier);

  let skillGamesAddr = process.env.SKILL_GAMES_SHARED_TICKETS_ADDRESS;
  if (skillGamesAddr) {
    console.log("Resuming with existing shared-ticket contract:", skillGamesAddr);
  } else {
    const constructorArgs = coder.encode(
      ["address", "address", "address"],
      [milesAddr, treasuryAddr, verifier]
    ).slice(2);
    const deploy = await sendTx(from, undefined, artifact.bytecode + constructorArgs);
    skillGamesAddr = deploy.receipt.contractAddress;
    console.log("AkibaSkillGamesV2SharedTickets deployed:", skillGamesAddr);
    console.log("Deploy tx:", deploy.hash);
  }

  for (const g of GAME_TYPES) {
    const data = iface.encodeFunctionData("setSupportedGameConfig", [
      g.id,
      true,
      g.entryCost * E18,
      g.maxReward * E18,
      g.maxStable,
      g.window,
    ]);
    const tx = await sendTx(from, skillGamesAddr, data);
    console.log(`Configured ${g.name}:`, tx.hash);
  }

  const wireTx = await sendTx(
    from,
    treasuryAddr,
    treasuryIface.encodeFunctionData("setGameContract", [skillGamesAddr])
  );
  console.log("GameTreasury.setGameContract:", wireTx.hash);

  const minterRaw = await hre.network.provider.request({
    method: "eth_call",
    params: [{ to: milesAddr, data: milesIface.encodeFunctionData("minters", [skillGamesAddr]) }, "latest"],
  }) as string;
  const [alreadyMinter] = coder.decode(["bool"], minterRaw);
  if (!alreadyMinter) {
    const minterTx = await sendTx(
      from,
      milesAddr,
      milesIface.encodeFunctionData("setMinter", [skillGamesAddr, true])
    );
    console.log("AkibaMilesV2.setMinter(skillGames):", minterTx.hash);
  } else {
    console.log("Skill games already has AkibaMilesV2 minter rights");
  }

  console.log("\nUpdate env:");
  console.log(`NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS=${skillGamesAddr}`);
  console.log(`SKILL_GAMES_CONTRACT_ADDRESS=${skillGamesAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
