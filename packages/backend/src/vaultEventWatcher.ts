// src/vaultEventWatcher.ts
// Watches the AkibaMilesVaultUUPS contract for Deposited and Withdrawn events.
// Maintains vault_positions (current balances) and vault_events (audit log)
// in Supabase so the rewards scheduler and API routes don't need to query
// the chain on every request.
//
// Run modes:
//   - Standalone:  `ts-node src/vaultEventWatcher.ts`
//   - Imported:    call startVaultEventWatcher() from index.ts
//
// On startup: backfills from the last processed block (stored in vault_watcher_state).
// Then polls every POLL_INTERVAL_MS for new events.

import * as dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ────────────────────────────────────────────────────────────────────

const VAULT_ADDRESS = process.env.VAULT_CONTRACT_ADDRESS ?? "";
const DEPLOYMENT_BLOCK = Number(process.env.VAULT_DEPLOYMENT_BLOCK ?? "0");
const POLL_INTERVAL_MS = Number(process.env.VAULT_WATCHER_POLL_MS ?? String(5 * 60 * 1000)); // 5 min
const BLOCKS_PER_BATCH = 2000; // Celo block time ~5s → ~2.7h per batch
const WATCHER_STATE_KEY = "default";

const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const VAULT_ABI = [
  "event Deposited(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount)",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toUsdt(raw: bigint): string {
  // USDT is 6 decimals — format as a fixed-decimal string e.g. "123.456789"
  const str = raw.toString().padStart(7, "0");
  return `${str.slice(0, -6)}.${str.slice(-6)}`;
}

async function getLastProcessedBlock(): Promise<number> {
  const { data, error } = await supabase
    .from("vault_watcher_state")
    .select("last_block")
    .eq("key", WATCHER_STATE_KEY)
    .maybeSingle();

  if (error) {
    console.error("[vaultWatcher] state read error", error);
    return DEPLOYMENT_BLOCK;
  }
  if (!data) return DEPLOYMENT_BLOCK;
  return Math.max(Number(data.last_block), DEPLOYMENT_BLOCK);
}

async function saveLastProcessedBlock(block: number): Promise<void> {
  const { error } = await supabase
    .from("vault_watcher_state")
    .upsert({ key: WATCHER_STATE_KEY, last_block: block, updated_at: new Date().toISOString() })
    .eq("key", WATCHER_STATE_KEY);

  if (error) console.error("[vaultWatcher] state write error", error);
}

async function upsertPosition(wallet: string, delta: bigint, isDeposit: boolean): Promise<void> {
  const addr = wallet.toLowerCase();

  // Read current balance
  const { data: existing } = await supabase
    .from("vault_positions")
    .select("balance_usdt")
    .eq("wallet_address", addr)
    .maybeSingle();

  const current = existing ? BigInt(existing.balance_usdt.replace(".", "").padStart(7, "0")) : 0n;

  // For withdrawals, clamp to zero to avoid negative balances from reorgs
  let newRaw: bigint;
  if (isDeposit) {
    newRaw = current + delta;
  } else {
    newRaw = current > delta ? current - delta : 0n;
  }

  // Reconstruct decimal string — both values are in 6-decimal units
  const newBalance = toUsdt(newRaw);

  const { error } = await supabase
    .from("vault_positions")
    .upsert({ wallet_address: addr, balance_usdt: newBalance, updated_at: new Date().toISOString() })
    .eq("wallet_address", addr);

  if (error) console.error("[vaultWatcher] position upsert error", error);
}

async function insertEvent(opts: {
  wallet: string;
  type: "deposit" | "withdrawal";
  amount: bigint;
  txHash: string;
  blockNumber: number;
}): Promise<void> {
  const { wallet, type, amount, txHash, blockNumber } = opts;
  const { error } = await supabase
    .from("vault_events")
    .insert({
      wallet_address: wallet.toLowerCase(),
      event_type: type,
      amount_usdt: toUsdt(amount),
      tx_hash: txHash,
      block_number: blockNumber,
    });

  // 23505 = unique_violation on tx_hash — already processed, safe to ignore
  if (error && error.code !== "23505") {
    console.error("[vaultWatcher] event insert error", error);
  }
}

// ── Core processing ───────────────────────────────────────────────────────────

async function processRange(
  contract: ethers.Contract,
  fromBlock: number,
  toBlock: number
): Promise<void> {
  const [deposited, withdrawn] = await Promise.all([
    contract.queryFilter(contract.filters.Deposited(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.Withdrawn(), fromBlock, toBlock),
  ]);

  // Merge and sort by block + log index so we apply in chronological order
  type LogEntry = {
    type: "deposit" | "withdrawal";
    log: ethers.EventLog;
  };

  const all: LogEntry[] = [
    ...deposited.map((l) => ({ type: "deposit" as const, log: l as ethers.EventLog })),
    ...withdrawn.map((l) => ({ type: "withdrawal" as const, log: l as ethers.EventLog })),
  ].sort((a, b) =>
    a.log.blockNumber !== b.log.blockNumber
      ? a.log.blockNumber - b.log.blockNumber
      : a.log.index - b.log.index
  );

  for (const { type, log } of all) {
    const user: string = log.args[0];
    const amount: bigint = log.args[1];
    const txHash = log.transactionHash;
    const blockNumber = log.blockNumber;

    await insertEvent({ wallet: user, type, amount, txHash, blockNumber });
    await upsertPosition(user, amount, type === "deposit");

    console.log(
      `[vaultWatcher] ${type} user=${user.slice(0, 8)}… amount=${toUsdt(amount)} USDT tx=${txHash.slice(0, 10)}…`
    );
  }
}

async function runOnce(): Promise<void> {
  if (!VAULT_ADDRESS) {
    console.warn("[vaultWatcher] VAULT_CONTRACT_ADDRESS not set — skipping");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

  const [lastBlock, latestBlock] = await Promise.all([
    getLastProcessedBlock(),
    provider.getBlockNumber(),
  ]);

  if (latestBlock <= lastBlock) {
    console.log(`[vaultWatcher] up to date at block ${lastBlock}`);
    return;
  }

  const fromBlock = lastBlock + 1;
  const toBlock = latestBlock;

  console.log(`[vaultWatcher] scanning blocks ${fromBlock}–${toBlock}`);

  // Process in batches to avoid RPC timeout on large ranges
  for (let start = fromBlock; start <= toBlock; start += BLOCKS_PER_BATCH) {
    const end = Math.min(start + BLOCKS_PER_BATCH - 1, toBlock);
    await processRange(contract, start, end);
    await saveLastProcessedBlock(end);
  }

  console.log(`[vaultWatcher] done — processed up to block ${toBlock}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startVaultEventWatcher(): void {
  console.log(`[vaultWatcher] starting — poll every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on startup (backfill)
  runOnce().catch((err) => console.error("[vaultWatcher] startup error", err));

  // Then poll on interval
  setInterval(() => {
    runOnce().catch((err) => console.error("[vaultWatcher] poll error", err));
  }, POLL_INTERVAL_MS);
}

// ── Standalone entry point ────────────────────────────────────────────────────

if (require.main === module) {
  startVaultEventWatcher();
  // Keep process alive
  setInterval(() => {}, 1 << 30);
}
