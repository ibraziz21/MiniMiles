import { ethers } from "ethers";
import cron from "node-cron";
import { randomUUID } from "crypto";
import { supabase } from "./supabaseClient";

const RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CONTRACT = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
const DRAIN_PK = process.env.DRAIN_PK ?? "";

const CELO_BLOCK_TIME_SECS = 5;
const DECIMALS = 18;
const ONE_AKIBAMILE = 10n ** BigInt(DECIMALS);
const PROSPERITY_PASS_BURN = 100n * ONE_AKIBAMILE;
const WATCH_INTERVAL_MINUTES = Number(process.env.BURN_WATCH_INTERVAL_MINUTES ?? "10");
const LOOKBACK_MINUTES = Number(process.env.BURN_WATCH_LOOKBACK_MINUTES ?? "12");
const MAX_TX_COUNT = Number(process.env.BURN_WATCH_MAX_TX_COUNT ?? "10");
const BATCH_SIZE = Number(process.env.BURN_WATCH_BATCH_SIZE ?? "200");
const LOCK_NAME = "burn_blacklist_watcher";
const LOCK_LEASE_SECONDS = 540;

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ZERO_ADDRESS_TOPIC = ethers.zeroPadValue(ethers.ZeroAddress, 32);

const BATCH_BLACKLIST_ABI = [
  "function batchSetBlacklist(address[] calldata accounts, bool blacklisted) external",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

const STABLE_TOKENS: { symbol: string; address: string }[] = [
  { symbol: "cUSD", address: process.env.CUSD_ADDRESS ?? "0x765DE816845861e75A25fCA122bb6898B8B1282a" },
  { symbol: "USDT", address: process.env.USDT_ADDRESS ?? "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" },
  { symbol: "USDC", address: process.env.USDC_ADDRESS ?? "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" },
];

const provider = new ethers.JsonRpcProvider(RPC);

let isRunning = false;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function isAlreadyBlacklisted(address: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("blacklisted_addresses")
    .select("address")
    .eq("address", address)
    .maybeSingle();

  if (error) {
    console.error(`[burnWatcher] blacklist lookup failed for ${address}:`, error.message);
    return false;
  }

  return !!data;
}

async function getStableBalancePresence(address: string): Promise<boolean> {
  const contracts = STABLE_TOKENS.map(
    (token) => new ethers.Contract(token.address, ERC20_ABI, provider),
  );

  const balances = await Promise.all(
    contracts.map((contract) => contract.balanceOf(address).catch(() => 0n)),
  );

  return balances.some((balance) => BigInt(balance) > 0n);
}

async function batchBlacklist(addresses: string[]) {
  if (addresses.length === 0) return;
  if (!DRAIN_PK) throw new Error("DRAIN_PK not set");

  const wallet = new ethers.Wallet(DRAIN_PK, provider);
  const contract = new ethers.Contract(CONTRACT, BATCH_BLACKLIST_ABI, wallet);
  const now = new Date().toISOString();

  for (const batch of chunk(addresses, BATCH_SIZE)) {
    console.log(`[burnWatcher] Blacklisting batch of ${batch.length}`);
    const tx = await contract.batchSetBlacklist(batch, true);
    console.log(`[burnWatcher] tx submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`[burnWatcher] ✓ confirmed: ${tx.hash}`);

    const rows = batch.map((address) => ({
      address,
      reason: "self-burn-no-stables-low-tx",
      blacklisted_at: now,
    }));

    const { error } = await supabase
      .from("blacklisted_addresses")
      .upsert(rows, { onConflict: "address", ignoreDuplicates: true });

    if (error) {
      console.error("[burnWatcher] Supabase upsert failed:", error.message);
    }
  }
}

export async function runBurnBlacklistWatcher() {
  if (isRunning) {
    console.log("[burnWatcher] Already running, skipping");
    return;
  }
  isRunning = true;
  let lockOwner: string | null = null;

  try {
    const owner = randomUUID();
    lockOwner = owner;
    const { data: acquired } = await supabase.rpc("acquire_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: owner,
      p_lease_seconds: LOCK_LEASE_SECONDS,
    });

    if (!acquired) {
      console.log("[burnWatcher] Distributed lock busy, skipping");
      return;
    }

    const latest = await provider.getBlockNumber();
    const lookbackBlocks = Math.max(
      1,
      Math.round((LOOKBACK_MINUTES * 60) / CELO_BLOCK_TIME_SECS),
    );
    const fromBlock = Math.max(0, latest - lookbackBlocks);

    console.log(`[burnWatcher] Scanning blocks ${fromBlock} → ${latest}`);

    const logs = await provider.getLogs({
      address: CONTRACT,
      topics: [TRANSFER_TOPIC, null, ZERO_ADDRESS_TOPIC],
      fromBlock,
      toBlock: latest,
    });

    if (logs.length === 0) {
      console.log("[burnWatcher] No burn events found");
      return;
    }

    const burnTotals = new Map<string, bigint>();

    for (const log of logs) {
      const burner = ethers.getAddress("0x" + log.topics[1].slice(26)).toLowerCase();
      const value = BigInt(log.data);
      burnTotals.set(burner, (burnTotals.get(burner) ?? 0n) + value);
    }

    const oneBurnWallets = [...burnTotals.entries()]
      // Only the exact 1-Mile probe burn is blacklistable here.
      // The Prosperity Pass flow burns 100 Miles and must never match this watcher.
      .filter(([, total]) => total === ONE_AKIBAMILE)
      .map(([address]) => address);

    console.log(`[burnWatcher] Wallets that burned exactly 1 AkibaMile: ${oneBurnWallets.length}`);
    const prosperityPassBurns = [...burnTotals.values()].filter((total) => total === PROSPERITY_PASS_BURN).length;
    if (prosperityPassBurns > 0) {
      console.log(`[burnWatcher] Ignored ${prosperityPassBurns} Prosperity Pass burn(s) of 100 AkibaMiles`);
    }

    const candidates = new Set<string>();

    for (const burner of oneBurnWallets) {
      if (await isAlreadyBlacklisted(burner)) continue;
      const [hasStableBalance, txCount] = await Promise.all([
        getStableBalancePresence(burner),
        provider.getTransactionCount(burner),
      ]);

      if (!hasStableBalance && txCount < MAX_TX_COUNT) {
        candidates.add(burner);
        console.log(`[burnWatcher] Flagged ${burner} (burn=1, stables=0, txCount=${txCount})`);
      }
    }

    const toBlacklist = [...candidates];
    if (toBlacklist.length === 0) {
      console.log("[burnWatcher] No exact-1-burn addresses matched blacklist rule");
      return;
    }

    await batchBlacklist(toBlacklist);
    console.log(`[burnWatcher] Done. ${toBlacklist.length} address(es) blacklisted.`);
  } catch (err: any) {
    console.error("[burnWatcher] Fatal:", err?.shortMessage ?? err?.message ?? err);
  } finally {
    if (lockOwner) {
      try {
        await supabase.rpc("release_minipoint_mint_queue_lock", {
          p_lock_name: LOCK_NAME,
          p_owner: lockOwner,
        });
      } catch {
        // best-effort lock release
      }
    }
    isRunning = false;
  }
}

export function startBurnBlacklistWatcher() {
  console.log(`[burnWatcher] Starting — runs every ${WATCH_INTERVAL_MINUTES} minute(s)`);
  runBurnBlacklistWatcher().catch(console.error);
  cron.schedule(`*/${WATCH_INTERVAL_MINUTES} * * * *`, () => {
    runBurnBlacklistWatcher().catch(console.error);
  });
}
