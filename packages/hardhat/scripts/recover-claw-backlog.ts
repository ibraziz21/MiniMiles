/**
 * Recover old Akiba Claw sessions from the Supabase settlement index.
 *
 * The chain is always treated as the source of truth. Rows are selected
 * oldest-first, then each session is advanced idempotently through:
 *   Pending -> commitOutcome (if needed) -> settleGame (if needed)
 *   Settled -> claimReward
 *
 * Safety controls:
 *   CLAW_RECOVERY_DRY_RUN=1          read-only reconciliation
 *   CLAW_RECOVERY_LIMIT=25           maximum rows examined in one run
 *   CLAW_RECOVERY_MIN_BALANCE_CELO=1 stop before spending the reserve
 *   CLAW_RECOVERY_MIN_SESSION_ID=0   optional inclusive lower bound
 *   CLAW_RECOVERY_MAX_SESSION_ID=0   optional inclusive upper bound (0 = none)
 *   CLAW_RECOVERY_SKIP_EPIC_CLAIMS=1 settle Epic sessions but leave USDT claims alone
 *   CLAW_RECOVERY_SESSION_IDS=1,2,3  explicit numeric IDs (bypasses DB selection)
 *   CLAW_RECOVERY_SCAN_FROM=1        discover actionable sessions directly on-chain
 *   CLAW_RECOVERY_SCAN_TO=9030       inclusive end of the on-chain scan
 *   CLAW_RECOVERY_SCAN_DESC=1        process scanned sessions newest-first
 *   CLAW_RECOVERY_CONCURRENCY=1      independent sessions processed together
 *   CLAW_RECOVERY_DELAY_MS=750       delay between sessions to protect the RPC
 */

import path from "path";
import { ethers } from "hardhat";
import { config as dotEnvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import clawArtifact from "../../react-app/contexts/akibaClawGame.json";
import batchRngAbi from "../../react-app/contexts/merkleBatchRng.json";

dotEnvConfig();
dotEnvConfig({ path: path.resolve(__dirname, "../../react-app/.env") });

const STATUS = {
  NONE: 0,
  PENDING: 1,
  SETTLED: 2,
  CLAIMED: 3,
  BURNED: 4,
  REFUNDED: 5,
} as const;

type BatchPlayRow = {
  session_id: string;
  batch_id: string;
  play_index: number;
  commit_status: string;
  created_at: string;
};

type BatchOutcome = {
  playIndex: number;
  rewardClass: number;
  proof: string[];
};

type BatchManifest = { plays: BatchOutcome[] };

class ReserveReachedError extends Error {}

function positiveInteger(name: string, fallback: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function normalizePrivateKey(value: string): `0x${string}` {
  if (!value) throw new Error("Set CELO_RELAYER_PK or PRIVATE_KEY");
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  }

  const limit = positiveInteger("CLAW_RECOVERY_LIMIT", 25);
  const dryRun = process.env.CLAW_RECOVERY_DRY_RUN === "1";
  const minSessionId = BigInt(process.env.CLAW_RECOVERY_MIN_SESSION_ID ?? "0");
  const maxSessionId = BigInt(process.env.CLAW_RECOVERY_MAX_SESSION_ID ?? "0");
  const skipEpicClaims = process.env.CLAW_RECOVERY_SKIP_EPIC_CLAIMS === "1";
  const explicitSessionIds = (process.env.CLAW_RECOVERY_SESSION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const scanFrom = BigInt(process.env.CLAW_RECOVERY_SCAN_FROM ?? "0");
  const scanTo = BigInt(process.env.CLAW_RECOVERY_SCAN_TO ?? "0");
  const scanDescending = process.env.CLAW_RECOVERY_SCAN_DESC === "1";
  const concurrency = positiveInteger("CLAW_RECOVERY_CONCURRENCY", 1);
  const delayMs = Number(process.env.CLAW_RECOVERY_DELAY_MS ?? "750");
  const reserve = ethers.parseEther(
    process.env.CLAW_RECOVERY_MIN_BALANCE_CELO ?? "1",
  );

  const clawAddress =
    process.env.CLAW_GAME_ADDRESS ??
    process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ??
    "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";
  const rngAddress =
    process.env.CLAW_BATCH_RNG_ADDRESS ??
    process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ??
    "0x249Ce901411809a8A0fECa6102D9F439bbf3751e";

  const relayerPk = normalizePrivateKey(
    process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "",
  );
  const provider = new ethers.JsonRpcProvider(
    process.env.CELO_RPC_URL ?? "https://forno.celo.org",
    42_220,
    { staticNetwork: true },
  );
  const wallet = new ethers.Wallet(relayerPk, provider);
  const claw = new ethers.Contract(clawAddress, clawArtifact.abi, wallet);
  const rng = new ethers.Contract(rngAddress, batchRngAbi, wallet);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const usesDirectChainSelection = explicitSessionIds.length > 0 || scanFrom > 0n;
  let rows: BatchPlayRow[];
  if (explicitSessionIds.length > 0) {
    rows = explicitSessionIds.slice(0, limit).map((sessionId) => ({
      session_id: BigInt(sessionId).toString(),
      batch_id: "",
      play_index: 0,
      commit_status: "pending",
      created_at: "",
    }));
  } else if (scanFrom > 0n) {
    if (scanTo < scanFrom) throw new Error("CLAW_RECOVERY_SCAN_TO must be >= SCAN_FROM");
    const multicall = new ethers.Contract(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
      ["function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)"],
      provider,
    );
    const clawInterface = new ethers.Interface(clawArtifact.abi);
    const discovered: BatchPlayRow[] = [];
    let discoveredPending = 0;
    let discoveredSettled = 0;
    const chunkSize = 250n;

    console.log(`Scanning on-chain sessions ${scanFrom}-${scanTo}...`);
    for (let start = scanFrom; start <= scanTo; start += chunkSize) {
      const end = start + chunkSize - 1n < scanTo ? start + chunkSize - 1n : scanTo;
      const ids = Array.from(
        { length: Number(end - start + 1n) },
        (_, index) => start + BigInt(index),
      );
      const calls = ids.map((id) => ({
        target: clawAddress,
        allowFailure: true,
        callData: clawInterface.encodeFunctionData("getSession", [id]),
      }));
      const results = await rpcRetry("chain scan", () => multicall.aggregate3.staticCall(calls));
      results.forEach((result: { success: boolean; returnData: string }, index: number) => {
        if (!result.success) return;
        const decoded = clawInterface.decodeFunctionResult("getSession", result.returnData)[0];
        const status = Number(decoded.status);
        if (status !== STATUS.PENDING && status !== STATUS.SETTLED) return;
        if (status === STATUS.PENDING) discoveredPending += 1;
        else discoveredSettled += 1;
        discovered.push({
          session_id: ids[index].toString(),
          batch_id: "",
          play_index: 0,
          commit_status: status === STATUS.PENDING ? "pending" : "committed",
          created_at: "",
        });
      });
    }

    console.log(JSON.stringify({
      scan: {
        from: scanFrom.toString(),
        to: scanTo.toString(),
        pending: discoveredPending,
        settled: discoveredSettled,
        actionable: discovered.length,
        minActionableSessionId: discovered[0]?.session_id ?? null,
        maxActionableSessionId: discovered.at(-1)?.session_id ?? null,
      },
    }));
    if (scanDescending) discovered.reverse();
    rows = discovered.slice(0, limit);
    console.log(`Discovered ${discovered.length} actionable on-chain sessions; selected ${rows.length}`);
  } else {
    // session_id is text in Supabase, so numeric min/max bounds are applied
    // client-side. PostgREST text comparisons would incorrectly include 573
    // in a 5000-5999 query.
    const { data, error } = await supabase
      .from("claw_batch_plays")
      .select("session_id,batch_id,play_index,commit_status,created_at")
      .in("commit_status", ["pending", "committed"])
      .order("created_at", { ascending: true })
      .limit(Math.max(limit, 5_000));
    if (error) throw new Error(`Failed to load claw backlog: ${error.message}`);
    rows = ((data ?? []) as BatchPlayRow[])
      .filter((row) => {
        const id = BigInt(row.session_id);
        return (minSessionId === 0n || id >= minSessionId) &&
          (maxSessionId === 0n || id <= maxSessionId);
      })
      .slice(0, limit);
  }
  const manifestCache = new Map<string, Promise<BatchManifest>>();
  const summary = {
    examined: 0,
    resolved: 0,
    alreadyFinal: 0,
    refunded: 0,
    failed: 0,
    skippedEpicClaims: 0,
    stoppedForReserve: false,
  };
  async function rpcRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        const detail = String(err?.shortMessage ?? err?.message ?? err).toLowerCase();
        const retryable = detail.includes("too many requests") ||
          detail.includes("429") || detail.includes("timeout") ||
          detail.includes("network");
        if (!retryable || attempt === 5) throw err;
        const waitMs = attempt * 1_500;
        console.log(`${label} RPC retry ${attempt}/5 in ${waitMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  }

  const startingBalance = await rpcRetry("starting balance", () => provider.getBalance(wallet.address));
  let availableBudget = startingBalance > reserve ? startingBalance - reserve : 0n;
  let stopRequested = false;
  let nextNonce = await rpcRetry("nonce", () =>
    provider.getTransactionCount(wallet.address, "pending")
  );

  async function audit(sessionId: string, stage: string, detail: string, success: boolean) {
    if (dryRun) return;
    await supabase.from("claw_settle_logs").insert({
      session_id: sessionId,
      stage,
      detail,
      success,
      created_at: new Date().toISOString(),
    });
  }

  async function loadOutcome(batchId: string, playIndex: number) {
    let manifestPromise = manifestCache.get(batchId);
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const result = await supabase
          .from("claw_batch_manifests")
          .select("manifest")
          .eq("batch_id", batchId)
          .single();
        if (result.error) {
          throw new Error(`Manifest ${batchId} unavailable: ${result.error.message}`);
        }
        const raw = result.data?.manifest as BatchManifest | Record<string, BatchManifest>;
        const manifest = "plays" in raw ? raw : raw[batchId];
        if (!manifest?.plays?.length) throw new Error(`Manifest ${batchId} is empty`);
        return manifest;
      })();
      manifestCache.set(batchId, manifestPromise);
    }

    let manifest: BatchManifest;
    try {
      manifest = await manifestPromise;
    } catch (err) {
      manifestCache.delete(batchId);
      throw err;
    }

    const outcome = manifest.plays.find((play) => play.playIndex === playIndex);
    if (!outcome) throw new Error(`No outcome for batch=${batchId} index=${playIndex}`);
    return outcome;
  }

  async function send(label: string, sessionId: string, request: ethers.TransactionRequest) {
    const feeData = await rpcRetry("fee data", () => provider.getFeeData());
    const estimatedGas = await rpcRetry("gas estimate", () => wallet.estimateGas(request));
    const gasLimit = estimatedGas * 120n / 100n;
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!maxFeePerGas) throw new Error("RPC did not return a usable gas price");
    const maximumCost = gasLimit * maxFeePerGas;

    if (availableBudget < maximumCost) {
      throw new ReserveReachedError(
        `Stopping before ${label}: spendable=${ethers.formatEther(availableBudget)} ` +
        `reserve=${ethers.formatEther(reserve)} maxCost=${ethers.formatEther(maximumCost)}`,
      );
    }
    // Reserve the maximum before the first await so concurrent sessions cannot
    // collectively overspend the configured balance floor.
    availableBudget -= maximumCost;
    const transactionNonce = nextNonce;
    nextNonce += 1;

    let tx: ethers.TransactionResponse | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        tx = await wallet.sendTransaction({ ...request, gasLimit, nonce: transactionNonce });
        break;
      } catch (err: any) {
        const detail = String(err?.shortMessage ?? err?.message ?? err).toLowerCase();
        if (attempt === 3 || !detail.includes("underpriced")) {
          availableBudget += maximumCost;
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (!tx) throw new Error(`${label} transaction was not submitted`);
    console.log(`[${sessionId}] ${label} submitted ${tx.hash}`);
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed`);
    const actualFee = receipt.fee;
    if (actualFee < maximumCost) availableBudget += maximumCost - actualFee;
    console.log(
      `[${sessionId}] ${label} confirmed gas=${receipt.gasUsed.toString()}`,
    );
    await audit(sessionId, `recovery_${label}`, tx.hash, true);
  }

  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "live",
    relayer: wallet.address,
    startingBalanceCelo: ethers.formatEther(startingBalance),
    reserveCelo: ethers.formatEther(reserve),
    concurrency,
    rows: rows.length,
  }));

  async function processRow(row: BatchPlayRow) {
    summary.examined += 1;
    const sessionId = BigInt(row.session_id);
    try {
      let session = await rpcRetry("getSession", () => claw.getSession(sessionId));
      let status = Number(session.status);
      let rewardClass = Number(session.rewardClass);
      let play = await rpcRetry("getSessionPlay", () => rng.getSessionPlay(sessionId));
      const chainBatchId = play.batchId.toString();
      const chainPlayIndex = Number(play.playIndex);

      console.log(
        `[${row.session_id}] status=${status} batch=${chainBatchId} ` +
        `index=${chainPlayIndex} committed=${Number(play.committedClass)}`,
      );

      if (status >= STATUS.CLAIMED) {
        summary.alreadyFinal += 1;
        if (status === STATUS.REFUNDED) summary.refunded += 1;
        if (!dryRun) {
          await supabase
            .from("claw_batch_plays")
            .update({ commit_status: "claimed", settled_at: new Date().toISOString() })
            .eq("session_id", row.session_id);
        }
        return;
      }

      if (status === STATUS.NONE) throw new Error("Session does not exist on-chain");
      if (chainBatchId === "0") throw new Error("Session has no on-chain batch assignment");
      if (chainBatchId !== row.batch_id || chainPlayIndex !== Number(row.play_index)) {
        console.log(
          `[${row.session_id}] correcting stale DB assignment ` +
          `${row.batch_id}/${row.play_index} -> ${chainBatchId}/${chainPlayIndex}`,
        );
        if (!dryRun) {
          await supabase.from("claw_batch_plays").update({
            batch_id: chainBatchId,
            play_index: chainPlayIndex,
          }).eq("session_id", row.session_id);
        }
      }

      if (usesDirectChainSelection && !dryRun) {
        await supabase.from("claw_batch_plays").upsert({
          session_id: row.session_id,
          batch_id: chainBatchId,
          play_index: chainPlayIndex,
          commit_status: Number(play.committedClass) === 0 ? "pending" : "committed",
        }, { onConflict: "session_id" });
      }

      if (dryRun) return;

      if (status === STATUS.PENDING && Number(play.committedClass) !== 0) {
        rewardClass = Number(play.committedClass);
      }

      if (status === STATUS.PENDING && Number(play.committedClass) === 0) {
        const outcome = await loadOutcome(chainBatchId, chainPlayIndex);
        rewardClass = outcome.rewardClass;
        const request = await rng.commitOutcome.populateTransaction(
          sessionId,
          outcome.rewardClass,
          outcome.proof,
        );
        await send("commit_outcome", row.session_id, request);
        await supabase
          .from("claw_batch_plays")
          .update({ commit_status: "committed" })
          .eq("session_id", row.session_id);
        // commitOutcome auto-settles the game. Trust the successful receipt;
        // an immediately-following RPC read may come from a lagging replica.
        status = STATUS.SETTLED;
      }

      if (status === STATUS.PENDING) {
        const request = await claw.settleGame.populateTransaction(sessionId);
        await send("settle_game", row.session_id, request);
        status = STATUS.SETTLED;
      }

      if (status === STATUS.SETTLED) {
        if (skipEpicClaims && rewardClass === 4) {
          summary.skippedEpicClaims += 1;
          console.log(`[${row.session_id}] Epic session settled; skipping USDT claim`);
          return;
        }
        const request = await claw.claimReward.populateTransaction(sessionId);
        await send("claim_reward", row.session_id, request);
        status = STATUS.CLAIMED;
      }

      if (status !== STATUS.CLAIMED && status !== STATUS.BURNED) {
        throw new Error(`Unexpected final status ${status}`);
      }

      await supabase
        .from("claw_batch_plays")
        .update({ commit_status: "claimed", settled_at: new Date().toISOString() })
        .eq("session_id", row.session_id);
      summary.resolved += 1;
    } catch (err: any) {
      if (err instanceof ReserveReachedError) {
        summary.stoppedForReserve = true;
        stopRequested = true;
        console.log(err.message);
        return;
      }
      summary.failed += 1;
      const detail = err?.shortMessage ?? err?.message ?? String(err);
      console.error(`[${row.session_id}] failed: ${detail}`);
      await audit(row.session_id, "recovery_error", detail, false);
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  for (let index = 0; index < rows.length && !stopRequested; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    await Promise.all(batch.map(processRow));
  }

  console.log(JSON.stringify({
    summary,
    endingBalanceCelo: ethers.formatEther(await rpcRetry("ending balance", () => provider.getBalance(wallet.address))),
  }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
