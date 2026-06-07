import { Router } from "express";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getBytes,
  hashMessage,
  id,
  keccak256,
  recoverAddress,
} from "ethers";
import { supabase } from "../supabaseClient";
import { GAME_TYPE_ID, PER_GAME_DAILY_PLAY_CAP, isGameType } from "./config";
import { akibaSkillGamesAbi, SETTLEMENT_TYPEHASH_PREIMAGE, START_INTENT_TYPEHASH_PREIMAGE } from "./contracts";
import { seedCommitment, validateMemoryFlipReplay, validateRuleTapReplay } from "./replayValidation";
import type { GameReplay, GameType, MemoryFlipReplay, RuleTapReplay } from "./types";

const router = Router();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220n;
const provider = new JsonRpcProvider(CELO_RPC);
const skillGamesAddress = process.env.SKILL_GAMES_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;
const verifierPk = process.env.SKILL_GAMES_VERIFIER_PK;
const SETTLEMENT_EXPIRY_SECONDS = Number(process.env.SKILL_GAMES_SETTLEMENT_EXPIRY_SECONDS ?? "3600");
const SETTLE_RETRY_INTERVAL_MS = Number(process.env.SKILL_GAMES_SETTLE_RETRY_INTERVAL_SECONDS ?? "30") * 1000;
const MAX_SETTLE_ATTEMPTS = Number(process.env.SKILL_GAMES_MAX_SETTLE_ATTEMPTS ?? "12");
const MAX_SETTLE_ATTEMPTS_PER_RUN = 3;

const BLOCKING_FLAGS = [
  "impossible_completion_time",
  "non_monotonic_action_log",
  "input_during_pair_evaluation_lock",
];

function getSkillGames(readonly = false) {
  if (!skillGamesAddress) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set");
  const runner = readonly || !verifierPk ? provider : new Wallet(verifierPk, provider);
  return new Contract(skillGamesAddress, akibaSkillGamesAbi, runner);
}

function toMilesUnits(miles: number): bigint {
  return BigInt(Math.round(miles)) * 10n ** 18n;
}

function toStableUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

function buildSettlementDigest(params: {
  sessionId: bigint;
  player: string;
  gameType: number;
  score: bigint;
  rewardMiles: bigint;
  rewardStable: bigint;
  expiry: bigint;
  verifyingContract: string;
}) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "uint8", "uint256", "uint256", "uint256", "uint256", "address", "uint256"],
      [
        id(SETTLEMENT_TYPEHASH_PREIMAGE),
        params.sessionId,
        params.player,
        params.gameType,
        params.score,
        params.rewardMiles,
        params.rewardStable,
        params.expiry,
        params.verifyingContract,
        CELO_CHAIN_ID,
      ]
    )
  );
}

async function signSettlementPayload(params: {
  sessionId: bigint;
  player: string;
  gameType: number;
  score: bigint;
  rewardMiles: bigint;
  rewardStable: bigint;
}) {
  if (!verifierPk || !skillGamesAddress) {
    throw new Error("skill-games-settlement-not-configured");
  }
  const expiry = BigInt(Math.floor(Date.now() / 1000) + SETTLEMENT_EXPIRY_SECONDS);
  const digest = buildSettlementDigest({
    sessionId: params.sessionId,
    player: params.player,
    gameType: params.gameType,
    score: params.score,
    rewardMiles: params.rewardMiles,
    rewardStable: params.rewardStable,
    expiry,
    verifyingContract: skillGamesAddress,
  });
  const wallet = new Wallet(verifierPk, provider);
  const signature = await wallet.signMessage(getBytes(digest));
  return { expiry, signature };
}

let settlementQueue: Promise<unknown> = Promise.resolve();

function enqueueSettlement<T>(work: () => Promise<T>): Promise<T> {
  const run = settlementQueue.catch(() => undefined).then(work);
  settlementQueue = run.catch(() => undefined);
  return run;
}

function onchainDayStart(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return new Date(Math.floor(nowSec / 86400) * 86400 * 1000).toISOString();
}

async function countGamePlaysToday(walletAddress: string, gameType: GameType) {
  const { count, error } = await supabase
    .from("skill_game_sessions")
    .select("*", { count: "exact", head: true })
    .eq("wallet_address", walletAddress.toLowerCase())
    .eq("game_type", gameType)
    .gte("created_at", onchainDayStart());
  if (error) throw error;
  return count ?? 0;
}

async function persistStartedSession(input: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: string;
}) {
  const { error } = await supabase.from("skill_game_sessions").upsert({
    session_id: input.sessionId,
    wallet_address: input.walletAddress.toLowerCase(),
    game_type: input.gameType,
    seed_commitment: input.seedCommitment,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

router.get("/status", async (req, res) => {
  try {
    const wallet = String(req.query.wallet ?? "");
    const gameType = req.query.gameType;
    if (!wallet || !isGameType(gameType)) {
      res.status(400).json({ error: "wallet and gameType required" });
      return;
    }
    const contract = getSkillGames(true);
    const [status, nonce] = await Promise.all([
      contract.playerStatus(wallet, GAME_TYPE_ID[gameType]),
      contract.startNonces(wallet),
    ]);
    res.json({
      credits: Number(status[0]),
      playsToday: Number(status[1]),
      playsRemaining: Math.min(Number(status[2]), PER_GAME_DAILY_PLAY_CAP),
      dailyCap: PER_GAME_DAILY_PLAY_CAP,
      nonce: Number(nonce),
      contractAvailable: true,
    });
  } catch (err: any) {
    console.error("[games/status]", err);
    res.status(502).json({ error: err?.message ?? "contract-read-failed" });
  }
});

router.post("/start-intent", async (req, res) => {
  try {
    if (!verifierPk || !skillGamesAddress) {
      res.status(503).json({ error: "backend-not-configured" });
      return;
    }

    const { gameType, walletAddress, seedCommitment: commitment, nonce, expiry, playerSignature } = req.body ?? {};
    if (!isGameType(gameType) || !walletAddress || !commitment || nonce == null || !expiry || !playerSignature) {
      res.status(400).json({ error: "missing-fields" });
      return;
    }
    if (Date.now() / 1000 > Number(expiry)) {
      res.status(400).json({ error: "intent-expired" });
      return;
    }
    if ((await countGamePlaysToday(walletAddress, gameType)) >= PER_GAME_DAILY_PLAY_CAP) {
      res.status(429).json({ error: "game-daily-cap-reached" });
      return;
    }

    // Recover signer from the player's intent signature before spending gas.
    try {
      const INTENT_TYPEHASH = id(START_INTENT_TYPEHASH_PREIMAGE);
      const CELO_CHAIN_ID_N = 42220n;
      const digest = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "uint8", "bytes32", "uint256", "uint256", "address", "uint256"],
          [INTENT_TYPEHASH, walletAddress, GAME_TYPE_ID[gameType], commitment, BigInt(nonce), BigInt(expiry), skillGamesAddress, CELO_CHAIN_ID_N]
        )
      );
      const recovered = recoverAddress(hashMessage(getBytes(digest)), playerSignature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(400).json({ error: "invalid-player-signature" });
        return;
      }
    } catch {
      res.status(400).json({ error: "invalid-player-signature" });
      return;
    }

    const contract = getSkillGames(false);
    const tx = await contract.startGameFor(
      walletAddress,
      GAME_TYPE_ID[gameType],
      commitment,
      BigInt(nonce),
      BigInt(expiry),
      playerSignature
    );
    const receipt = await tx.wait(1);
    const iface = new Interface(akibaSkillGamesAbi);
    let sessionId: string | null = null;
    for (const log of receipt.logs ?? []) {
      try {
        const decoded = iface.parseLog(log);
        if (decoded?.name === "GameStarted") {
          sessionId = decoded.args.sessionId.toString();
          break;
        }
      } catch {
        // not our event
      }
    }
    if (!sessionId) {
      res.status(500).json({ error: "session-id-not-found-in-receipt" });
      return;
    }
    await persistStartedSession({ sessionId, walletAddress, gameType, seedCommitment: commitment });
    res.json({ sessionId, txHash: tx.hash });
  } catch (err: any) {
    console.error("[games/start-intent]", err);
    res.status(500).json({ error: err?.shortMessage ?? err?.message ?? "contract-error" });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const { gameType, sessionId, walletAddress, replay } = req.body as {
      gameType?: GameType;
      sessionId?: string;
      walletAddress?: string;
      replay?: GameReplay;
    };
    if (!isGameType(gameType) || !sessionId || !walletAddress || !replay) {
      res.status(400).json({ accepted: false, error: "missing-fields" });
      return;
    }

    if ((await countGamePlaysToday(walletAddress, gameType)) > PER_GAME_DAILY_PLAY_CAP) {
      res.json({
        accepted: false,
        antiAbuseFlags: ["daily_cap_exceeded"],
        result: { sessionId, gameType, score: 0, mistakes: 0, completed: false, elapsedMs: 0, rewardMiles: 0, rewardStable: 0 },
        settled: false,
      });
      return;
    }

    const replaySeed = (replay as any).seed as string | undefined;
    if (!replaySeed) {
      res.status(400).json({ accepted: false, error: "missing-seed" });
      return;
    }
    const { data: sessionRow } = await supabase
      .from("skill_game_sessions")
      .select("seed_commitment, accepted")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (sessionRow?.accepted === true) {
      res.status(409).json({ accepted: false, error: "session-already-settled" });
      return;
    }

    const expectedCommitment = sessionRow?.seed_commitment as string | undefined;
    if (expectedCommitment) {
      const actualCommitment = seedCommitment(replaySeed, walletAddress, gameType);
      if (actualCommitment.toLowerCase() !== expectedCommitment.toLowerCase()) {
        res.status(400).json({ accepted: false, error: "seed-commitment-mismatch" });
        return;
      }
    }

    const validation =
      gameType === "rule_tap"
        ? validateRuleTapReplay(replay as RuleTapReplay)
        : validateMemoryFlipReplay(replay as MemoryFlipReplay);
    const accepted = !validation.flags.some((flag) => BLOCKING_FLAGS.includes(flag));

    const { error: updateError } = await supabase.from("skill_game_sessions").upsert({
      session_id: sessionId,
      wallet_address: walletAddress.toLowerCase(),
      game_type: gameType,
      score: validation.result.score,
      reward_miles: accepted ? validation.result.rewardMiles : 0,
      reward_stable: accepted ? validation.result.rewardStable : 0,
      accepted,
      anti_abuse_flags: validation.flags,
    });
    if (updateError) throw updateError;

    if (!accepted) {
      res.json({
        accepted: false,
        antiAbuseFlags: validation.flags,
        result: { ...validation.result, rewardMiles: 0, rewardStable: 0 },
        settled: false,
      });
      return;
    }
    if (!verifierPk || !skillGamesAddress) {
      res.json({ accepted: true, antiAbuseFlags: validation.flags, result: validation.result, settlement: null, settled: false });
      return;
    }

    const rewardMiles = toMilesUnits(validation.result.rewardMiles);
    const rewardStable = toStableUnits(validation.result.rewardStable);
    const score = BigInt(validation.result.score);
    const numericSessionId = BigInt(sessionId);
    const chainGameType = GAME_TYPE_ID[gameType];
    const { expiry, signature } = await signSettlementPayload({
      sessionId: numericSessionId,
      player: walletAddress,
      gameType: chainGameType,
      score,
      rewardMiles,
      rewardStable,
    });

    // Persist the signed payload so the retry job can resubmit without re-signing.
    await supabase.from("skill_game_sessions").update({
      settlement_sig:    signature,
      settlement_expiry: Number(expiry),
    }).eq("session_id", sessionId);

    // Fire settlement in the background — don't block the HTTP response.
    // retryPendingSettlements() will catch any failures automatically.
    void attemptSettle(sessionId, numericSessionId, score, rewardMiles, rewardStable, expiry, signature);

    res.json({
      accepted: true,
      antiAbuseFlags: validation.flags,
      result: validation.result,
      queued: true,
    });
  } catch (err: any) {
    console.error("[games/verify]", err);
    res.status(500).json({ accepted: false, error: err?.message ?? "server-error" });
  }
});

router.get("/settlement-status", async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId ?? "");
    const wallet = typeof req.query.wallet === "string"
      ? req.query.wallet.toLowerCase()
      : null;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }

    let query = supabase
      .from("skill_game_sessions")
      .select("session_id, wallet_address, accepted, settle_tx_hash, settled_at, settle_attempts, settlement_expiry, reward_miles, reward_stable, anti_abuse_flags")
      .eq("session_id", sessionId);

    if (wallet) query = query.eq("wallet_address", wallet);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const settlementExpiry = Number(data.settlement_expiry ?? 0);
    res.json({
      sessionId: data.session_id,
      accepted: Boolean(data.accepted),
      settled: Boolean(data.settled_at),
      settleTxHash: data.settle_tx_hash,
      settledAt: data.settled_at,
      settleAttempts: Number(data.settle_attempts ?? 0),
      settlementExpired: settlementExpiry > 0 && settlementExpiry <= nowSec,
      retryable: Boolean(data.accepted) &&
        !data.settled_at &&
        Number(data.settle_attempts ?? 0) < MAX_SETTLE_ATTEMPTS,
      rewardMiles: Number(data.reward_miles ?? 0),
      rewardStable: Number(data.reward_stable ?? 0),
      antiAbuseFlags: data.anti_abuse_flags ?? [],
    });
  } catch (err: any) {
    console.error("[games/settlement-status]", err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

const VERIFIER_LOW_BALANCE_CELO = 0.5; // warn below this

async function checkVerifierBalance() {
  if (!verifierPk) return;
  try {
    const wallet = new Wallet(verifierPk, provider);
    const bal = await provider.getBalance(wallet.address);
    const celo = Number(bal) / 1e18;
    if (celo < VERIFIER_LOW_BALANCE_CELO) {
      console.error(`[games/settle] ⚠️  VERIFIER WALLET LOW ON GAS: ${celo.toFixed(4)} CELO — top up ${wallet.address}`);
    }
  } catch { /* non-fatal */ }
}

async function attemptSettle(
  sessionId: string,
  numericSessionId: bigint,
  score: bigint,
  rewardMiles: bigint,
  rewardStable: bigint,
  expiry: bigint,
  signature: string,
  priorAttempts = 0,
): Promise<string | false> {
  return enqueueSettlement(() =>
    attemptSettleLocked(
      sessionId,
      numericSessionId,
      score,
      rewardMiles,
      rewardStable,
      expiry,
      signature,
      priorAttempts
    )
  );
}

async function attemptSettleLocked(
  sessionId: string,
  numericSessionId: bigint,
  score: bigint,
  rewardMiles: bigint,
  rewardStable: bigint,
  expiry: bigint,
  signature: string,
  priorAttempts = 0,
): Promise<string | false> {
  const attemptsThisRun = Math.max(
    0,
    Math.min(MAX_SETTLE_ATTEMPTS_PER_RUN, MAX_SETTLE_ATTEMPTS - priorAttempts)
  );
  if (attemptsThisRun === 0) return false;

  for (let attempt = 1; attempt <= attemptsThisRun; attempt++) {
    const totalAttempts = priorAttempts + attempt;
    try {
      const contract = getSkillGames(false);
      const tx = await contract.settleGame(numericSessionId, score, rewardMiles, rewardStable, expiry, signature);
      await tx.wait(1);
      await supabase.from("skill_game_sessions").update({
        settle_tx_hash: tx.hash,
        settled_at: new Date().toISOString(),
        settle_attempts: totalAttempts,
      }).eq("session_id", sessionId);
      console.log(`[games/settle] ✅ session ${sessionId} settled tx=${tx.hash}`);
      return tx.hash as string;
    } catch (err: any) {
      const msg = err?.shortMessage ?? err?.message ?? String(err);
      console.error(`[games/settle] attempt ${totalAttempts} for session ${sessionId} failed:`, msg);
      // Increment total attempt count so the retry cron can bound retries correctly
      await supabase.from("skill_game_sessions")
        .update({ settle_attempts: totalAttempts })
        .eq("session_id", sessionId);
      if (msg.includes("AlreadySettled") || msg.includes("already settled")) {
        await supabase.from("skill_game_sessions").update({
          settled_at: new Date().toISOString(),
          settle_attempts: totalAttempts,
        }).eq("session_id", sessionId);
        console.warn(`[games/settle] session ${sessionId} was already settled on-chain; marked settled locally`);
        return "already-settled";
      }
      // Insufficient funds — stop immediately and alert; retrying won't help
      if (msg.includes("insufficient funds")) {
        console.error(`[games/settle] ❌ VERIFIER OUT OF GAS — halting settle for session ${sessionId}`);
        void checkVerifierBalance();
        return false;
      }
      if (attempt < attemptsThisRun) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  return false;
}

// Retry accepted sessions that were never settled on-chain (e.g. process restart mid-flight).
// Re-signs expired settlement payloads so accepted sessions do not get stranded.
let retryPendingSettlementsRunning = false;

async function retryPendingSettlements() {
  if (!verifierPk || !skillGamesAddress) return;
  if (retryPendingSettlementsRunning) return;
  retryPendingSettlementsRunning = true;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const { data, error } = await supabase
      .from("skill_game_sessions")
      .select("session_id, wallet_address, game_type, score, reward_miles, reward_stable, settlement_sig, settlement_expiry, settle_attempts")
      .eq("accepted", true)
      .is("settled_at", null)
      .lt("settle_attempts", MAX_SETTLE_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) { console.error("[games/settle-retry] query failed", error); return; }
    if (!data?.length) return;

    console.log(`[games/settle-retry] retrying ${data.length} unsettled sessions`);
    for (const row of data) {
      if (!isGameType(row.game_type)) {
        console.error(`[games/settle-retry] invalid game_type for session ${row.session_id}: ${row.game_type}`);
        continue;
      }

      const numericSessionId = BigInt(row.session_id);
      const score = BigInt(row.score);
      const rewardMiles = toMilesUnits(Number(row.reward_miles));
      const rewardStable = toStableUnits(Number(row.reward_stable));
      const priorAttempts = Number(row.settle_attempts ?? 0);
      let expiry = BigInt(row.settlement_expiry ?? 0);
      let signature = row.settlement_sig as string | null;

      if (!signature || Number(expiry) <= nowSec + 60) {
        const signed = await signSettlementPayload({
          sessionId: numericSessionId,
          player: row.wallet_address,
          gameType: GAME_TYPE_ID[row.game_type],
          score,
          rewardMiles,
          rewardStable,
        });
        expiry = signed.expiry;
        signature = signed.signature;
        await supabase.from("skill_game_sessions").update({
          settlement_sig: signature,
          settlement_expiry: Number(expiry),
        }).eq("session_id", row.session_id);
        console.log(`[games/settle-retry] refreshed expired settlement signature session=${row.session_id}`);
      }

      await attemptSettle(
        row.session_id,
        numericSessionId,
        score,
        rewardMiles,
        rewardStable,
        expiry,
        signature,
        priorAttempts
      );
    }
  } finally {
    retryPendingSettlementsRunning = false;
  }
}

setTimeout(() => { void retryPendingSettlements(); }, 5000);
setInterval(() => { void retryPendingSettlements(); }, SETTLE_RETRY_INTERVAL_MS);

export default router;
