// Opens a new CrackPot cycle: seeds Supabase + calls openCycle on-chain.
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import * as path from "path";
import * as https from "https";

dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });
dotEnvConfig(); // also load hardhat/.env for PRIVATE_KEY

const CRACKPOT_ADDRESS = "0x32E2eBD9B502563a3B8FA59207F0542709456906";
const THEME_NAMES = [
  "bank-vault","dna-lab","launch-code","treasure-map","potion-brew",
  "signal-decode","cyber-lock","star-chart","spice-market","circuit-board",
] as const;

const ABI = [
  "function openCycle(uint8 version, uint64 expiresAt) external",
  "function activeCycleId(uint8 version) external view returns (uint256)",
];

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data.trim()));
    }).on("error", () => resolve(""));
  });
}

function generateCode(entropy: string): [number,number,number,number] {
  const rng = crypto.randomBytes(32);
  const combined = crypto.createHash("sha256").update(rng).update(entropy).digest();
  return [combined[0]%6, combined[1]%6, combined[2]%6, combined[3]%6];
}

function getTheme(date: Date) {
  const day = Math.floor(date.getTime() / 86_400_000);
  return THEME_NAMES[day % THEME_NAMES.length];
}

// Hourly: expires at top of next UTC hour
function getExpiresAt(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

async function main() {
  const version = (process.argv[2] ?? "miles") as "miles" | "usdt";
  const contractVersion = version === "usdt" ? 1 : 0;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  // Check no active cycle already exists
  const { data: existing } = await supabase
    .from("crackpot_cycles")
    .select("id,status")
    .eq("version", version)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    console.log(`Active ${version} cycle already exists: ${existing.id}`);
    process.exit(0);
  }

  // Get entropy from BTC latest block hash
  const btcHash = await fetchUrl("https://blockchain.info/q/latesthash");
  const entropy = btcHash || `fallback-${Date.now()}`;
  console.log("Entropy source:", entropy.slice(0, 20) + "...");

  const now = new Date();
  const theme = getTheme(now);
  const secretCode = generateCode(entropy);
  const expiresAt = getExpiresAt();

  console.log("Theme         :", theme);
  console.log("Secret code   :", secretCode, "(never sent to client)");
  console.log("Expires at    :", expiresAt.toISOString());
  console.log("Version       :", version);

  // 1. Insert into Supabase
  const seed = version === "miles" ? 200 : 200; // 200 miles or 200 cents ($2.00)
  const cap  = version === "miles" ? 10000 : 5000;

  const { data: cycle, error } = await supabase
    .from("crackpot_cycles")
    .insert({
      version,
      theme,
      secret_code: secretCode,
      entropy_source: entropy,
      status: "active",
      pot_balance: seed,
      pot_cap: cap,
      seed_amount: seed,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase insert failed:", error.message);
    process.exit(1);
  }
  console.log("\n✅ Supabase cycle created:", cycle.id);

  // 2. Call openCycle on contract
  const [deployer] = await ethers.getSigners();
  const contract = new ethers.Contract(CRACKPOT_ADDRESS, ABI, deployer);
  const expiresAtUnix = BigInt(Math.floor(expiresAt.getTime() / 1000));

  console.log("Opening cycle on-chain...");
  const tx = await contract.openCycle(contractVersion, expiresAtUnix);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed block:", receipt.blockNumber);

  // Verify contract state
  const activeCycleId = await contract.activeCycleId(contractVersion);
  console.log("Contract activeCycleId:", activeCycleId.toString());

  console.log(`\n✅ ${version.toUpperCase()} cycle is LIVE`);
  console.log("   Supabase id :", cycle.id);
  console.log("   Contract id :", activeCycleId.toString());
  console.log("   Expires     :", expiresAt.toISOString());
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
