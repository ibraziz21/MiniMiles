/**
 * recover-crackpot-cycle.ts
 *
 * Recovers a stuck CrackPot cycle. If the on-chain cycle for a version has
 * expired (so enterGame() reverts with "CrackPot: cycle expired") but was never
 * rolled over, this expires it and opens a fresh one — unblocking entries.
 *
 * The off-chain DB cycle re-aligns on the next /api/crackpot/cycle/current load
 * (the hardened route mirrors the DB expiry to the chain).
 *
 * Must be run by the CrackPot relayer/owner (0x7d63…4403).
 *
 * Env:
 *   NEXT_PUBLIC_CRACKPOT_ADDRESS (or CRACKPOT_ADDRESS)
 *   CRACKPOT_RECOVER_VERSION   0 = MILES (default), 1 = USDT
 *   CRACKPOT_CYCLE_SECONDS     new cycle length in seconds (default 3600)
 *
 * Run:
 *   PRIVATE_KEY=<relayer key for 0x7d63…4403> \
 *     npx hardhat run scripts/recover-crackpot-cycle.ts \
 *     --config hardhat.crackpot.config.ts --network celo
 */

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";

dotEnvConfig();

const ABI = [
  "function getActiveCycle(uint8 version) view returns ((uint256 id,uint8 version,uint8 status,uint256 potBalance,uint256 potCap,uint256 seedAmount,uint256 houseAccrued,uint64 openedAt,uint64 expiresAt,address winner,uint256 winnerGuesses))",
  "function expireCycle(uint8 version) external",
  "function openCycle(uint8 version, uint64 expiresAt) external",
  "function relayer() view returns (address)",
  "function owner() view returns (address)",
];

function nextNonceFromError(err: unknown): number | undefined {
  const message =
    err instanceof Error ? `${err.message}\n${err.stack ?? ""}`
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message) : String(err);
  const match = message.match(/next nonce\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function send(label: string, build: (nonce: number) => Promise<any>, signerAddr: string) {
  let nonceOverride: number | undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const nonce = nonceOverride ?? (await ethers.provider.getTransactionCount(signerAddr, "pending"));
    try {
      console.log(`  ${label} attempt ${attempt}: nonce ${nonce}`);
      const tx = await build(nonce);
      console.log(`  ${label} tx:`, tx.hash);
      await tx.wait();
      return;
    } catch (err) {
      const nextNonce = nextNonceFromError(err);
      if (nextNonce === undefined || attempt === 5) throw err;
      console.log(`  ${label} nonce ${nonce} stale; retry with ${nextNonce}`);
      nonceOverride = nextNonce;
    }
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const cpAddr = process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? process.env.CRACKPOT_ADDRESS
    ?? "0x32E2eBD9B502563a3B8FA59207F0542709456906";
  const version = Number(process.env.CRACKPOT_RECOVER_VERSION ?? "0");
  const cycleSeconds = Number(process.env.CRACKPOT_CYCLE_SECONDS ?? "3600");

  const cp = new ethers.Contract(cpAddr, ABI, signer);
  const relayer = await cp.relayer().catch(() => null);
  console.log("CrackPot:", cpAddr);
  console.log("Version :", version === 1 ? "USDT" : "MILES");
  console.log("Relayer :", relayer ?? "(n/a)");
  console.log("Signer  :", signer.address);

  if (relayer && relayer.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not the CrackPot relayer. Use ${relayer}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  let active = await cp.getActiveCycle(version).catch(() => null);
  const expired = active && Number(active.expiresAt) <= now;

  if (active && !expired) {
    console.log(`\nCycle #${active.id} is active and not expired (expires in ${Number(active.expiresAt) - now}s). Nothing to do.`);
    return;
  }

  if (active && expired) {
    console.log(`\nCycle #${active.id} expired ${now - Number(active.expiresAt)}s ago — expiring it…`);
    await send("expireCycle", (nonce) => cp.expireCycle(version, { nonce }), signer.address);
  }

  const newExpiry = now + cycleSeconds;
  console.log(`\nOpening a fresh cycle (expires in ${cycleSeconds}s)…`);
  await send("openCycle", (nonce) => cp.openCycle(version, newExpiry, { nonce }), signer.address);

  const fresh = await cp.getActiveCycle(version);
  console.log(`\nDone. New cycle #${fresh.id}, expires ${new Date(Number(fresh.expiresAt) * 1000).toISOString()}.`);
  console.log("enterGame() will now succeed; the DB cycle re-aligns on the next cycle/current load.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
