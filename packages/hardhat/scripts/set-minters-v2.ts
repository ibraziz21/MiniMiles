/**
 * set-minters-v2.ts
 *
 * Post-deploy setup for AkibaMilesV2:
 *   1. Registers the backend wallet as a minter (so API can mint/burn)
 *   2. Sets the V1 token address (enables claimV2Tokens() for users)
 *
 * .env required:
 *   MINIPOINTS_V2_ADDRESS=   (V2 proxy, from deploy-akiba-v2.ts output)
 *   MINIPOINTS_ADDRESS=      (V1 proxy address)
 *   BACKEND_WALLET=          (wallet address that PRIVATE_KEY controls)
 *
 * Run:
 *   npx hardhat run scripts/set-minters-v2.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const V2_ABI = [
  "function setMinter(address who, bool enabled) external",
  "function setV1Token(address _v1) external",
  "function minters(address) view returns (bool)",
  "function v1Token() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Setting up V2 with:", deployer.address);

  const v2Address = process.env.MINIPOINTS_V2_ADDRESS;
  const v1Address = process.env.MINIPOINTS_ADDRESS;
  const backendWallet = process.env.BACKEND_WALLET;

  if (!v2Address) throw new Error("Set MINIPOINTS_V2_ADDRESS in .env");
  if (!v1Address) throw new Error("Set MINIPOINTS_ADDRESS (V1) in .env");
  if (!backendWallet) throw new Error("Set BACKEND_WALLET in .env");

  const v2 = new ethers.Contract(v2Address, V2_ABI, deployer);

  console.log("\n1. Registering backend wallet as minter...");
  const tx1 = await v2.setMinter(backendWallet, true);
  await tx1.wait();
  const isMinter = await v2.minters(backendWallet);
  console.log(`   minters(${backendWallet}) = ${isMinter}`);

  console.log("\n2. Setting V1 token address...");
  const tx2 = await v2.setV1Token(v1Address);
  await tx2.wait();
  const storedV1 = await v2.v1Token();
  console.log(`   v1Token() = ${storedV1}`);

  console.log("\nDone. V2 is ready for minting and self-serve migration.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
