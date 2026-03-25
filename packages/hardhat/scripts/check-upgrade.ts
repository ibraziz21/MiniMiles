/**
 * check-upgrade.ts
 * Verifies that setMiniPoints() exists on the upgraded proxies
 * by reading the implementation address and checking the function selector.
 */
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SET_MINI_POINTS_SELECTOR = "0x" + Buffer.from(
  ethers.id("setMiniPoints(address)").slice(2, 10), "hex"
).toString("hex");

async function checkProxy(label: string, proxyAddr: string) {
  // Get implementation address from ERC1967 slot
  const raw = await ethers.provider.getStorage(proxyAddr, IMPL_SLOT);
  const implAddr = "0x" + raw.slice(26);
  console.log(`\n${label}`);
  console.log(`  Proxy:          ${proxyAddr}`);
  console.log(`  Implementation: ${implAddr}`);

  // Check if setMiniPoints selector exists in implementation bytecode
  const code = await ethers.provider.getCode(implAddr);
  const selector = ethers.id("setMiniPoints(address)").slice(0, 10);
  const hasSelector = code.includes(selector.slice(2));
  console.log(`  setMiniPoints() present: ${hasSelector ? "✅ YES" : "❌ NO — upgrade needed"}`);
}

async function main() {
  const raffleAddr = process.env.RAFFLE_V6_ADDRESS;
  const diceAddr = process.env.DICE_ADDRESS;
  if (!raffleAddr) throw new Error("Set RAFFLE_V6_ADDRESS in .env");
  if (!diceAddr) throw new Error("Set DICE_ADDRESS in .env");

  await checkProxy("AkibaRaffleV6", raffleAddr);
  await checkProxy("AkibaDiceGame", diceAddr);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
