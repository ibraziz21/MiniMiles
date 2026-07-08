// Read live CrackPot chain state — read-only, no transactions.
// Run: npx hardhat run --config hardhat.config.ts scripts/crackpot-read-state.ts --network celo
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import * as path from "path";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });
dotEnvConfig();

const PROXY = "0x32E2eBD9B502563a3B8FA59207F0542709456906";

const ABI = [
  "function activeCycleId(uint8 version) external view returns (uint256)",
  "function getActiveCycle(uint8 version) external view returns (tuple(uint256 id,uint8 version,uint8 status,uint256 potBalance,uint256 potCap,uint256 seedAmount,uint256 houseAccrued,uint64 openedAt,uint64 expiresAt,address winner,uint256 winnerGuesses,bytes32 secretCommitment))",
  "function getCycle(uint256 cycleId) external view returns (tuple(uint256 id,uint8 version,uint8 status,uint256 potBalance,uint256 potCap,uint256 seedAmount,uint256 houseAccrued,uint64 openedAt,uint64 expiresAt,address winner,uint256 winnerGuesses,bytes32 secretCommitment))",
  "function usdtAccounting() external view returns (uint256 balance, uint256 reservedPot, uint256 houseWithdrawable, uint256 freeBalance)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const contract  = new ethers.Contract(PROXY, ABI, signer);
  const now       = Math.floor(Date.now() / 1000);

  console.log("=== CrackPot Live Chain State ===");
  console.log("Proxy:", PROXY);
  console.log("Block:", (await ethers.provider.getBlockNumber()).toString());
  console.log("");

  // ── MILES (version 0) ──────────────────────────────────────────────────────
  const milesId = await contract.activeCycleId(0);
  console.log("activeCycleId(MILES=0):", milesId.toString());
  if (milesId > 0n) {
    const c = await contract.getActiveCycle(0);
    const exp = Number(c.expiresAt);
    console.log("  cycle id:        ", c.id.toString());
    console.log("  version:         ", c.version);
    console.log("  status:          ", c.status, "(0=active,1=cracked)");
    console.log("  potBalance:      ", c.potBalance.toString(), "wei (18-dec =", (BigInt(c.potBalance) / 10n**18n).toString(), "Miles)");
    console.log("  expiresAt:       ", new Date(exp * 1000).toISOString());
    console.log("  expired?:        ", exp <= now ? "YES (stale)" : "no");
    console.log("  secretCommitment:", c.secretCommitment);
  } else {
    console.log("  → no active Miles cycle on-chain");
  }

  // ── Cycle 127 specifically ─────────────────────────────────────────────────
  console.log("");
  try {
    const c127 = await contract.getCycle(127);
    console.log("Cycle 127:");
    console.log("  id:              ", c127.id.toString());
    console.log("  version:         ", c127.version, "(0=miles,1=usdt)");
    console.log("  status:          ", c127.status);
    console.log("  expiresAt:       ", new Date(Number(c127.expiresAt) * 1000).toISOString());
    console.log("  secretCommitment:", c127.secretCommitment);
    console.log("  potBalance:      ", c127.potBalance.toString());
    const exp127 = Number(c127.expiresAt);
    console.log("  expired?:        ", exp127 <= now ? "YES" : "no");
  } catch (e: any) {
    console.log("Cycle 127: error reading —", e.shortMessage ?? e.message);
  }

  // ── USDT (version 1) ───────────────────────────────────────────────────────
  console.log("");
  const usdtId = await contract.activeCycleId(1);
  console.log("activeCycleId(USDT=1):", usdtId.toString());
  if (usdtId > 0n) {
    const c = await contract.getActiveCycle(1);
    const exp = Number(c.expiresAt);
    console.log("  cycle id:        ", c.id.toString());
    console.log("  status:          ", c.status);
    console.log("  expiresAt:       ", new Date(exp * 1000).toISOString());
    console.log("  expired?:        ", exp <= now ? "YES (stale)" : "no");
    console.log("  secretCommitment:", c.secretCommitment);
  } else {
    console.log("  → no active USDT cycle on-chain");
  }

  // ── USDT accounting ────────────────────────────────────────────────────────
  console.log("");
  const acc = await contract.usdtAccounting();
  console.log("usdtAccounting:");
  console.log("  balance:          ", acc[0].toString(), "(micro-USDT = $" + (Number(acc[0]) / 1_000_000).toFixed(2) + ")");
  console.log("  reservedPot:      ", acc[1].toString());
  console.log("  houseWithdrawable:", acc[2].toString());
  console.log("  freeBalance:      ", acc[3].toString(), "(micro-USDT = $" + (Number(acc[3]) / 1_000_000).toFixed(2) + ")");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
