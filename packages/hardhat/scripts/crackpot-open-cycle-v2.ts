// CrackPot chain-first cycle opener — commitment-aware (v2).
//
// What this script does (in order):
//   1. Read live chain state for version=MILES.
//   2. Mark any expired legacy DB rows dead (orphaned pre-upgrade rows).
//   3. If chain cycle is stale → call expireCycle(MILES) on-chain.
//   4. Confirm activeCycleId(MILES) == 0.
//   5. Compute keccak256 commitment matching the CrackPot.sol algorithm.
//   6. Call openCycle(MILES, expiresAt, secretCommitment) on-chain.
//   7. Confirm CycleOpened event and new activeCycleId.
//   8. Insert DB row with chain_id, contract_cycle_id, secret_salt,
//      secret_commitment, open_tx_hash, commitment_algorithm.
//
// Run: npx hardhat run --config hardhat.config.ts \
//        scripts/crackpot-open-cycle-v2.ts --network celo
//
// Safety: reads chain state first, prints planned txs before sending,
//         writes DB only AFTER chain confirms.

import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import * as path from "path";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });
dotEnvConfig();

const PROXY = "0x32E2eBD9B502563a3B8FA59207F0542709456906";
const CHAIN_ID = 42220;
const COMMITMENT_ALGORITHM =
  'keccak256(abi.encodePacked("CRACKPOT_SECRET_V1", chainId, contractAddress, contractVersion, expiresAt, secretSalt, secretCode))';

const THEME_NAMES = [
  "bank-vault", "dna-lab", "launch-code", "treasure-map", "potion-brew",
  "signal-decode", "cyber-lock", "star-chart", "spice-market", "circuit-board",
] as const;

const ABI = [
  "function activeCycleId(uint8 version) external view returns (uint256)",
  "function getActiveCycle(uint8 version) external view returns (tuple(uint256 id,uint8 version,uint8 status,uint256 potBalance,uint256 potCap,uint256 seedAmount,uint256 houseAccrued,uint64 openedAt,uint64 expiresAt,address winner,uint256 winnerGuesses,bytes32 secretCommitment))",
  "function expireCycle(uint8 version) external",
  "function openCycle(uint8 version, uint64 expiresAt, bytes32 secretCommitment) external",
  "event CycleOpened(uint256 indexed cycleId, uint8 version, uint256 potSeed, uint64 expiresAt, bytes32 secretCommitment)",
];

function getTheme(date: Date) {
  const day = Math.floor(date.getTime() / 86_400_000);
  return THEME_NAMES[day % THEME_NAMES.length];
}

// Miles cycles expire at top of next UTC hour.
function getMilesExpiresAt(): Date {
  const next = new Date();
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

// Must match CRACKPOT_PEGS in packages/react-app/lib/crackpotTypes.ts — the
// contract only stores the opaque commitment hash, so this script and the
// app must independently agree on the preimage shape or a manually-opened
// cycle will silently mismatch the guess API's peg count.
const CRACKPOT_PEGS = 5;

function generateCode(entropy: string): number[] {
  const rng = crypto.randomBytes(32);
  const combined = crypto.createHash("sha256").update(rng).update(entropy).digest();
  return Array.from({ length: CRACKPOT_PEGS }, (_, i) => combined[i] % 6);
}

function computeCommitment(
  chainId: bigint,
  contractAddress: string,
  contractVersion: number,
  expiresAtSec: bigint,
  salt: string,           // 64-char hex, no 0x
  code: number[],
): string {
  const codeHex = code.map(n => n.toString(16).padStart(2, "0")).join("");
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint8", "uint64", "bytes32", `bytes${code.length}`],
    [
      "CRACKPOT_SECRET_V1",
      chainId,
      contractAddress,
      contractVersion,
      expiresAtSec,
      "0x" + salt,
      "0x" + codeHex,
    ],
  );
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  const [relayer] = await ethers.getSigners();
  const contract = new ethers.Contract(PROXY, ABI, relayer);
  const now = Math.floor(Date.now() / 1000);

  console.log("=== CrackPot Chain-First Open (v2) ===");
  console.log("Proxy     :", PROXY);
  console.log("Relayer   :", relayer.address);
  console.log("Block     :", (await ethers.provider.getBlockNumber()).toString());
  console.log("");

  // ── Step 1: Read chain state ───────────────────────────────────────────────
  const chainMilesId = await contract.activeCycleId(0);
  console.log("activeCycleId(MILES=0):", chainMilesId.toString());

  let chainCycle: any = null;
  if (chainMilesId > 0n) {
    chainCycle = await contract.getActiveCycle(0);
    const exp = Number(chainCycle.expiresAt);
    console.log("Chain cycle", chainCycle.id.toString(),
      "| status:", chainCycle.status,
      "| expires:", new Date(exp * 1000).toISOString(),
      exp <= now ? "← STALE" : "← live"
    );
    console.log("Commitment:", chainCycle.secretCommitment);
  }

  // ── Step 2: Mark legacy orphaned DB rows dead ──────────────────────────────
  // An orphaned row has status='active' but chain_id IS NULL and is expired.
  const { data: orphans, error: orphanErr } = await supabase
    .from("crackpot_cycles")
    .update({ status: "dead" })
    .eq("version", "miles")
    .eq("status", "active")
    .is("chain_id", null)
    .lt("expires_at", new Date().toISOString())
    .select("id, expires_at");

  if (orphanErr) {
    console.warn("⚠ Could not clean orphaned rows:", orphanErr.message);
  } else if (orphans && orphans.length > 0) {
    console.log("\n→ Marked", orphans.length, "expired legacy DB row(s) dead:");
    orphans.forEach((r: any) => console.log("  ", r.id, r.expires_at));
  } else {
    console.log("\n→ No expired legacy rows to clean up");
  }

  // ── Step 3: Expire stale chain cycle ──────────────────────────────────────
  if (chainCycle && Number(chainCycle.expiresAt) <= now) {
    const staleId = Number(chainCycle.id);
    console.log("\n── Tx 1: expireCycle(MILES=0) ────────────────────────────────");
    console.log("Will call expireCycle(uint8 version=0) on", PROXY);
    console.log("Effect: clears stale cycle", staleId, "from chain (returns pot to free balance)");
    console.log("Sending...");

    const tx = await contract.expireCycle(0);
    console.log("Expire tx hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Confirmed block:", receipt.blockNumber, "| gas:", receipt.gasUsed.toString());

    // Mark DB row dead if it has a chain anchor (it doesn't for cycle 127, but be safe).
    const { error: deadErr } = await supabase
      .from("crackpot_cycles")
      .update({ status: "dead", expire_tx_hash: tx.hash })
      .eq("chain_id", CHAIN_ID)
      .eq("contract_version", 0)
      .eq("contract_cycle_id", staleId)
      .in("status", ["active", "settling"]);

    if (deadErr) console.warn("⚠ DB markDead:", deadErr.message);
    else console.log("→ DB row for cycle", staleId, "marked dead (if existed)");

    // Confirm cleared
    const clearedId = await contract.activeCycleId(0);
    if (clearedId !== 0n) {
      throw new Error(`expireCycle did not clear — activeCycleId still ${clearedId}`);
    }
    console.log("✓ activeCycleId(MILES=0) == 0 (confirmed cleared)");
    chainCycle = null;
  } else if (!chainCycle) {
    console.log("\n→ No active chain cycle — ready to open");
  } else {
    console.log("\n→ Chain cycle is still live — won't open a new one");
    process.exit(0);
  }

  // ── Step 4: Compute commitment + open new cycle ────────────────────────────
  const expiresAt = getMilesExpiresAt();
  const expiresAtSec = BigInt(Math.floor(expiresAt.getTime() / 1000));
  const entropyTs = Date.now();
  const entropy = String(entropyTs);
  const secretCode = generateCode(entropy);
  const salt = crypto.randomBytes(32).toString("hex");
  const commitment = computeCommitment(
    BigInt(CHAIN_ID), PROXY, 0, expiresAtSec, salt, secretCode,
  );
  const theme = getTheme(new Date());

  // Preimage recovery log — in case the script crashes before DB insert.
  // KEEP THIS OUTPUT PRIVATE.  Delete from terminal history after run.
  process.stderr.write(
    `[RECOVERY] secretCode=${JSON.stringify(secretCode)} salt=${salt} commitment=${commitment} expiresAtSec=${expiresAtSec}\n`,
  );

  console.log("\n── Tx 2: openCycle(MILES=0, expiresAt, secretCommitment) ─────");
  console.log("Will call openCycle(uint8 version=0, uint64 expiresAt=" + expiresAtSec + ", bytes32 secretCommitment=...)");
  console.log("Planned expiresAt:", expiresAt.toISOString());
  console.log("secretCommitment :", commitment);
  console.log("(secret_code not printed to stdout — see stderr for recovery)");
  console.log("Sending...");

  const openTx = await contract.openCycle(0, expiresAtSec, commitment);
  console.log("Open tx hash:", openTx.hash);
  const openReceipt = await openTx.wait();
  console.log("Confirmed block:", openReceipt.blockNumber, "| gas:", openReceipt.gasUsed.toString());

  // Decode CycleOpened event — use event data directly, no extra RPC call needed.
  const iface = new ethers.Interface(ABI);
  const openedLog = openReceipt.logs
    .map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((l: any) => l?.name === "CycleOpened");

  if (!openedLog) {
    throw new Error("CycleOpened event not found in receipt — open may have failed");
  }

  const contractCycleId = Number(openedLog.args.cycleId);
  const eventCommitment = openedLog.args.secretCommitment as string;
  const eventPotSeed    = openedLog.args.potSeed as bigint;
  const eventExpiresAt  = openedLog.args.expiresAt as bigint;

  console.log("CycleOpened event: cycleId=", contractCycleId, "commitment=", eventCommitment);

  if (eventCommitment.toLowerCase() !== commitment.toLowerCase()) {
    throw new Error(`Commitment mismatch! Event: ${eventCommitment} vs computed: ${commitment}`);
  }
  console.log("✓ On-chain commitment matches server-computed commitment");

  // Use event data for DB insert (avoid a second getActiveCycle call that may lag).
  // Miles: 18-dec → whole miles. potSeed is potBalance at open time.
  const MILES_CAP = 10_000; // hard-coded contract configuration
  const potBalance     = Number(eventPotSeed / 10n ** 18n);
  const potCap         = MILES_CAP;
  const seedAmount     = potBalance;
  const chainExpiresAt = new Date(Number(eventExpiresAt) * 1000).toISOString();

  // Verify activeCycleId via a simple uint256 read (more reliable than getActiveCycle).
  const confirmedId = await contract.activeCycleId(0);
  if (Number(confirmedId) !== contractCycleId) {
    console.warn("⚠ activeCycleId mismatch:", confirmedId.toString(), "vs event", contractCycleId);
  } else {
    console.log("✓ activeCycleId(0) ==", contractCycleId);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("crackpot_cycles")
    .insert({
      version:              "miles",
      theme,
      secret_code:          secretCode,
      entropy_source:       "server-rng-" + entropyTs,
      status:               "active",
      pot_balance:          potBalance,
      pot_cap:              potCap,
      seed_amount:          seedAmount,
      expires_at:           chainExpiresAt,
      chain_id:             CHAIN_ID,
      contract_cycle_id:    contractCycleId,
      contract_version:     0,
      secret_salt:          salt,
      secret_commitment:    commitment,
      open_tx_hash:         openTx.hash,
      commitment_algorithm: COMMITMENT_ALGORITHM,
    })
    .select("id, contract_cycle_id, secret_commitment, chain_id")
    .single();

  if (insErr) {
    console.error("\n✗ DB insert failed:", insErr.message);
    console.error("Chain cycle IS live — DB row must be inserted manually.");
    console.error("Contract cycle id:", contractCycleId);
    console.error("Secret salt (KEEP PRIVATE):", salt);
    console.error("Secret code (KEEP PRIVATE):", secretCode);
    process.exit(1);
  }

  console.log("\n✅ DB row inserted:");
  console.log("  Supabase id       :", inserted.id);
  console.log("  chain_id          :", inserted.chain_id);
  console.log("  contract_cycle_id :", inserted.contract_cycle_id);
  console.log("  secret_commitment :", inserted.secret_commitment);

  console.log("\n=== Summary ===");
  console.log("Expire tx hash  :", "(see above — sent during step 3 if cycle was stale)");
  console.log("Open tx hash    :", openTx.hash);
  console.log("New cycle id    :", contractCycleId);
  console.log("Supabase row id :", inserted.id);
  console.log("Expires at      :", chainExpiresAt);
  console.log("secretCommitment:", commitment);
}

main().catch((e) => { console.error("\n✗ Script failed:", e.message ?? e); process.exit(1); });
