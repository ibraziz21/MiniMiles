// Expire the current active CrackPot cycle for MILES (version 0).
// Run: npx hardhat run --config hardhat.config.ts scripts/crackpot-expire-cycle.ts --network celo
// Tx sent: expireCycle(uint8 version=0) on the CrackPot proxy.
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import * as path from "path";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });
dotEnvConfig();

const PROXY = "0x32E2eBD9B502563a3B8FA59207F0542709456906";
const ABI = [
  "function activeCycleId(uint8 version) external view returns (uint256)",
  "function expireCycle(uint8 version) external",
];

async function main() {
  const [relayer] = await ethers.getSigners();
  const contract = new ethers.Contract(PROXY, ABI, relayer);
  const now = Math.floor(Date.now() / 1000);

  const activeId = await contract.activeCycleId(0);
  console.log("activeCycleId(MILES=0):", activeId.toString());
  if (activeId === 0n) {
    console.log("No active Miles cycle — nothing to expire.");
    return;
  }

  console.log("Sending expireCycle(0) — will clear cycle", activeId.toString(), "on-chain...");
  const tx = await contract.expireCycle(0);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed block:", receipt.blockNumber, "| gas:", receipt.gasUsed.toString());

  const clearedId = await contract.activeCycleId(0);
  console.log("activeCycleId(0) after expire:", clearedId.toString(), clearedId === 0n ? "✓" : "⚠ unexpected");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
