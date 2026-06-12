import { Router } from "express";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getBytes,
  id,
  keccak256,
} from "ethers";
import { supabase } from "../supabaseClient";
import { GAME_TYPE_ID, PER_GAME_DAILY_PLAY_CAP, isGameType } from "./config";
import { akibaSkillGamesAbi, SETTLEMENT_TYPEHASH_PREIMAGE } from "./contracts";
import { seedCommitment, validateMemoryFlipReplay, validateRuleTapReplay } from "./replayValidation";
import {
  applyFlip,
  buildMemoryDeck,
  finalizeMemoryFlip,
  MEMORY_FLIP_CARD_COUNT,
  MEMORY_FLIP_DURATION_MS,
  newServerSeed,
  serverSeedHash,
  type MemoryServerState,
} from "./memoryFlipServer";
import {
  applyTap,
  buildRuleTapSession,
  finalizeRuleTap,
  revealedTiles,
  RULE_TAP_DURATION_MS,
  RULE_TAP_GRID_SIZE,
  RULE_TAP_REVEAL_LEAD_MS,
  RULE_TAP_TICK_MS,
  type RuleTapState,
} from "./ruleTapServer";
import {
  applyShot,
  finalizePenaltyPressure,
  newPenaltyState,
  stateFromPenaltyRow,
  PENALTY_SHOTS,
  PENALTY_DURATION_MS,
  type ShotRecord,
} from "./penaltyPressureServer";
import type { GameReplay, GameType, MemoryFlipReplay, RuleTapReplay } from "./types";

const router = Router();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220n;
const provider = new JsonRpcProvider(CELO_RPC);
const skillGamesAddress = process.env.SKILL_GAMES_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;
const verifierPk = process.env.SKILL_GAMES_VERIFIER_PK;
const SETTLEMENT_EXPIRY_SECONDS = Number(process.env.SKILL_GAMES_SETTLEMENT_EXPIRY_SECONDS ?? "3600");
const SETTLE_RETRY_INTERVAL_MS = Number(process.env.SKILL_GAMES_SETTLE_RETRY_INTERVAL_SECONDS ?? "30") * 1000;
const SETTLE_RECEIPT_TIMEOUT_MS = Number(process.env.SKILL_GAMES_SETTLE_RECEIPT_TIMEOUT_SECONDS ?? "45") * 1000;
const MAX_SETTLE_ATTEMPTS = Number(process.env.SKILL_GAMES_MAX_SETTLE_ATTEMPTS ?? "12");
const MAX_SETTLE_ATTEMPTS_PER_RUN = 3;
// How long a worker's settlement claim is honoured before another instance may
// re-claim a stranded row (e.g. the claiming process crashed mid-flight).
const SETTLE_CLAIM_LEASE_MS = Number(process.env.SKILL_GAMES_SETTLE_CLAIM_LEASE_SECONDS ?? "90") * 1000;
// A replay can only be legitimate if at least its claimed duration of wall-clock
// time has elapsed since the session was created on-chain. Tolerance absorbs
// block-timestamp vs. confirmation skew and network latency.
const REPLAY_WALL_CLOCK_TOLERANCE_MS = Number(process.env.SKILL_GAMES_REPLAY_WALL_CLOCK_TOLERANCE_MS ?? "3000");
// Memory Flip and Rule Tap are now server-authoritative (/games/session/*). The
// legacy replay path lets a client submit a precomputed board, so it is rejected
// by default. Set these to "true" only during a rollout window where an old
// client still posts replays; remove once the new client is fully deployed.
const ALLOW_LEGACY_MEMORY_VERIFY = process.env.SKILL_GAMES_ALLOW_LEGACY_MEMORY_VERIFY === "true";
const ALLOW_LEGACY_RULE_TAP_VERIFY = process.env.SKILL_GAMES_ALLOW_LEGACY_RULE_TAP_VERIFY === "true";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const BLOCKING_FLAGS = [
  "invalid_replay_seed",
  "invalid_started_at",
  "replay_duration_out_of_bounds",
  "invalid_action_log",
  "too_many_actions",
  "invalid_action_shape",
  "action_offset_out_of_bounds",
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
    );
  });
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

type OnchainSession = {
  sessionId: string;
  player: string;
  gameType: number;
  createdAt: number;
  seedCommitment: string;
  settled: boolean;
};

type SkillGameSessionRow = {
  session_id: string;
  wallet_address: string;
  game_type: GameType;
  score: number | string | null;
  reward_miles: number | string | null;
  reward_stable: number | string | null;
  accepted: boolean | null;
  anti_abuse_flags: string[] | null;
  seed_commitment: string | null;
  settle_tx_hash: string | null;
  settle_attempts: number | null;
  settled_at: string | null;
  settlement_sig: string | null;
  settlement_expiry: number | string | null;
};

function getResultFromRow(row: SkillGameSessionRow, fallback: {
  sessionId: string;
  gameType: GameType;
  elapsedMs?: number;
}) {
  return {
    sessionId: fallback.sessionId,
    gameType: fallback.gameType,
    score: Number(row.score ?? 0),
    mistakes: 0,
    completed: Number(row.score ?? 0) > 0,
    elapsedMs: fallback.elapsedMs ?? 0,
    rewardMiles: Number(row.reward_miles ?? 0),
    rewardStable: Number(row.reward_stable ?? 0),
  };
}

function parseSessionId(sessionId: string | bigint) {
  if (typeof sessionId === "bigint") return sessionId;
  if (!/^\d+$/.test(sessionId)) {
    const err = new Error("invalid-session-id") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return BigInt(sessionId);
}

async function readOnchainSessionOnce(sessionId: string | bigint): Promise<OnchainSession | null> {
  const numericSessionId = parseSessionId(sessionId);
  const session = await getSkillGames(true).sessions(numericSessionId);
  const storedSessionId = BigInt(session.sessionId ?? session[0]);
  const player = String(session.player ?? session[1]).toLowerCase();

  if (storedSessionId === 0n || player === ZERO_ADDRESS) return null;

  return {
    sessionId: storedSessionId.toString(),
    player,
    gameType: Number(session.gameType ?? session[2]),
    createdAt: Number(session.createdAt ?? session[4]),
    seedCommitment: String(session.seedCommitment ?? session[5]).toLowerCase(),
    settled: Boolean(session.settled ?? session[6]),
  };
}

// A session created by a just-confirmed startGame tx can be momentarily invisible
// on a lagging RPC node. Retry a few times before declaring it missing so that
// register-start / session-init don't 404 on a propagation race.
const ONCHAIN_READ_RETRIES = Number(process.env.SKILL_GAMES_ONCHAIN_READ_RETRIES ?? "4");
const ONCHAIN_READ_RETRY_DELAY_MS = Number(process.env.SKILL_GAMES_ONCHAIN_READ_RETRY_DELAY_MS ?? "1000");

async function readOnchainSession(
  sessionId: string | bigint,
  opts: { retryOnMissing?: boolean } = {},
): Promise<OnchainSession | null> {
  const attempts = opts.retryOnMissing ? Math.max(1, ONCHAIN_READ_RETRIES) : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const found = await readOnchainSessionOnce(sessionId);
    if (found) return found;
    if (attempt < attempts) {
      console.warn(`[games/onchain-read] session ${sessionId} not visible yet (attempt ${attempt}/${attempts}) — retrying`);
      await new Promise((r) => setTimeout(r, ONCHAIN_READ_RETRY_DELAY_MS));
    }
  }
  return null;
}

function assertOnchainSessionMatches(input: {
  onchain: OnchainSession | null;
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: string;
}) {
  if (!input.onchain) {
    return "session-not-found-on-chain";
  }
  if (input.onchain.sessionId !== input.sessionId) {
    return "session-id-mismatch";
  }
  if (input.onchain.player !== input.walletAddress.toLowerCase()) {
    return "session-player-mismatch";
  }
  if (input.onchain.gameType !== GAME_TYPE_ID[input.gameType]) {
    return "session-game-type-mismatch";
  }
  if (input.onchain.seedCommitment !== input.seedCommitment.toLowerCase()) {
    return "seed-commitment-mismatch";
  }
  return null;
}

async function persistStartedSession(input: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: string;
  createdAt?: string;
}) {
  const { error } = await supabase.from("skill_game_sessions").upsert({
    session_id: input.sessionId,
    wallet_address: input.walletAddress.toLowerCase(),
    game_type: input.gameType,
    seed_commitment: input.seedCommitment,
    created_at: input.createdAt ?? new Date().toISOString(),
  });
  if (error) throw error;
}

async function persistVerifiedStartedSession(input: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: string;
}) {
  const onchain = await readOnchainSession(input.sessionId, { retryOnMissing: true });
  const mismatch = assertOnchainSessionMatches({ ...input, onchain });
  if (mismatch) {
    const err = new Error(mismatch) as Error & { status?: number };
    err.status = mismatch === "session-not-found-on-chain" ? 404 : 400;
    throw err;
  }
  if (!onchain) {
    const err = new Error("session-not-found-on-chain") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  await persistStartedSession({
    ...input,
    createdAt: new Date(onchain.createdAt * 1000).toISOString(),
  });
  return onchain;
}

async function persistStartedSessionFromReceipt(input: {
  receipt: any;
  walletAddress: string;
  gameType: GameType;
  seedCommitment: string;
}) {
  const iface = new Interface(akibaSkillGamesAbi);
  for (const log of input.receipt.logs ?? []) {
    try {
      const decoded = iface.parseLog(log);
      if (decoded?.name !== "GameStarted") continue;

      const sessionId = decoded.args.sessionId.toString();
      const player = String(decoded.args.player).toLowerCase();
      const chainGameType = Number(decoded.args.gameType);
      const seedCommitment = String(decoded.args.seedCommitment).toLowerCase();

      if (player !== input.walletAddress.toLowerCase()) continue;
      if (chainGameType !== GAME_TYPE_ID[input.gameType]) continue;
      if (seedCommitment !== input.seedCommitment.toLowerCase()) continue;

      await persistStartedSession({
        sessionId,
        walletAddress: input.walletAddress,
        gameType: input.gameType,
        seedCommitment: input.seedCommitment,
      });
      return sessionId;
    } catch {
      // not our event
    }
  }
  return null;
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

router.get("/register-start", async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId ?? "");
    const walletAddress = String(req.query.walletAddress ?? req.query.wallet ?? "");
    const gameType = req.query.gameType;
    const seedCommitment = String(req.query.seedCommitment ?? "");

    if (!sessionId || !walletAddress || !isGameType(gameType) || !seedCommitment) {
      res.status(400).json({ error: "sessionId, walletAddress, gameType and seedCommitment required" });
      return;
    }

    const onchain = await persistVerifiedStartedSession({
      sessionId,
      walletAddress,
      gameType,
      seedCommitment,
    });

    res.json({
      registered: true,
      sessionId: onchain.sessionId,
      walletAddress: onchain.player,
      gameType,
      seedCommitment: onchain.seedCommitment,
    });
  } catch (err: any) {
    console.error("[games/register-start]", err);
    res.status(err?.status ?? 500).json({ error: err?.message ?? "server-error" });
  }
});

router.post("/register-start", async (req, res) => {
  try {
    const { sessionId, walletAddress, gameType, seedCommitment: commitment } = req.body ?? {};
    if (!sessionId || !walletAddress || !isGameType(gameType) || !commitment) {
      res.status(400).json({ error: "sessionId, walletAddress, gameType and seedCommitment required" });
      return;
    }

    const onchain = await persistVerifiedStartedSession({
      sessionId: String(sessionId),
      walletAddress: String(walletAddress),
      gameType,
      seedCommitment: String(commitment),
    });

    res.json({
      registered: true,
      sessionId: onchain.sessionId,
      walletAddress: onchain.player,
      gameType,
      seedCommitment: onchain.seedCommitment,
    });
  } catch (err: any) {
    console.error("[games/register-start]", err);
    res.status(err?.status ?? 500).json({ error: err?.message ?? "server-error" });
  }
});

router.post("/start-intent", async (_req, res) => {
  res.status(410).json({ error: "sponsored-start-disabled" });
});

router.get("/start-intent-status", async (req, res) => {
  try {
    const txHash = String(req.query.txHash ?? "");
    const walletAddress = String(req.query.walletAddress ?? req.query.wallet ?? "");
    const gameType = req.query.gameType;
    const seedCommitment = String(req.query.seedCommitment ?? "");

    if (!txHash || !walletAddress || !isGameType(gameType) || !seedCommitment) {
      res.status(400).json({ error: "txHash, walletAddress, gameType and seedCommitment required" });
      return;
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      res.json({ pending: true, txHash });
      return;
    }
    if (receipt.status === 0) {
      res.status(500).json({ pending: false, error: "start-transaction-reverted", txHash });
      return;
    }

    const sessionId = await persistStartedSessionFromReceipt({
      receipt,
      walletAddress,
      gameType,
      seedCommitment,
    });
    if (!sessionId) {
      res.status(404).json({ pending: false, error: "session-id-not-found-in-receipt", txHash });
      return;
    }

    res.json({ pending: false, sessionId, txHash });
  } catch (err: any) {
    console.error("[games/start-intent-status]", err);
    res.status(500).json({ error: err?.message ?? "server-error" });
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

    // These no longer trust client replays — they run server-authoritative.
    if (gameType === "memory_flip" && !ALLOW_LEGACY_MEMORY_VERIFY) {
      res.status(410).json({ accepted: false, error: "memory-flip-uses-server-authoritative-flow" });
      return;
    }
    if (gameType === "rule_tap" && !ALLOW_LEGACY_RULE_TAP_VERIFY) {
      res.status(410).json({ accepted: false, error: "rule-tap-uses-server-authoritative-flow" });
      return;
    }

    const replaySeed = (replay as any).seed as string | undefined;
    if (!replaySeed) {
      res.status(400).json({ accepted: false, error: "missing-seed" });
      return;
    }

    const actualCommitment = seedCommitment(replaySeed, walletAddress, gameType).toLowerCase();
    const onchain = await readOnchainSession(sessionId);
    const mismatch = assertOnchainSessionMatches({
      onchain,
      sessionId,
      walletAddress,
      gameType,
      seedCommitment: actualCommitment,
    });
    if (mismatch) {
      res.status(mismatch === "session-not-found-on-chain" ? 404 : 400).json({ accepted: false, error: mismatch });
      return;
    }
    if (!onchain) {
      res.status(404).json({ accepted: false, error: "session-not-found-on-chain" });
      return;
    }

    // Wall-clock binding: you cannot have finished an N-second game if fewer than
    // N seconds of real time have elapsed since the start tx was mined on-chain.
    // This kills the "start session → precompute board → submit a flawless replay
    // 200ms later" attack without depending on any timing heuristic.
    const claimedDurationMs = typeof (replay as any).durationMs === "number" && Number.isFinite((replay as any).durationMs)
      ? (replay as any).durationMs
      : 0;
    const elapsedSinceStartMs = Date.now() - onchain.createdAt * 1000;
    if (claimedDurationMs > 0 && elapsedSinceStartMs + REPLAY_WALL_CLOCK_TOLERANCE_MS < claimedDurationMs) {
      res.status(400).json({ accepted: false, error: "replay-submitted-too-soon" });
      return;
    }

    const { data: sessionRow, error: sessionError } = await supabase
      .from("skill_game_sessions")
      .select("session_id, wallet_address, game_type, score, reward_miles, reward_stable, accepted, anti_abuse_flags, seed_commitment, settle_tx_hash, settle_attempts, settled_at, settlement_sig, settlement_expiry")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;

    const expectedCommitment = (sessionRow?.seed_commitment as string | undefined)?.toLowerCase();
    if (expectedCommitment && actualCommitment !== expectedCommitment) {
      res.status(400).json({ accepted: false, error: "seed-commitment-mismatch" });
      return;
    }
    if (onchain.settled && sessionRow?.accepted !== true) {
      res.status(409).json({ accepted: false, error: "session-already-settled-on-chain" });
      return;
    }

    if (!expectedCommitment) {
      await persistStartedSession({
        sessionId,
        walletAddress,
        gameType,
        seedCommitment: onchain.seedCommitment,
        createdAt: new Date(onchain.createdAt * 1000).toISOString(),
      });
    }

    if (sessionRow?.accepted === true) {
      const settlement = await queueSettlementForAcceptedRow(sessionRow as SkillGameSessionRow, {
        sessionId,
        walletAddress,
        gameType,
        elapsedMs: (replay as any).durationMs,
      });
      res.json({
        accepted: true,
        antiAbuseFlags: sessionRow.anti_abuse_flags ?? [],
        result: settlement.result,
        queued: settlement.queued,
        settled: settlement.settled,
        settleTxHash: settlement.settleTxHash,
      });
      return;
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
    // Claim the lease first so a concurrent retry sweep on another instance does
    // not also broadcast for this session. retryPendingSettlements() will pick it
    // up if we fail to claim or the broadcast fails.
    if (await tryClaimSettlement(sessionId)) {
      void attemptSettle(sessionId, numericSessionId, score, rewardMiles, rewardStable, expiry, signature);
    }

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

async function markSettledIfOnchain(sessionId: string, numericSessionId: bigint, attempts: number) {
  try {
    const onchain = await readOnchainSession(numericSessionId);
    if (!onchain?.settled) return false;

    await supabase.from("skill_game_sessions").update({
      settled_at: new Date().toISOString(),
      settle_attempts: attempts,
    }).eq("session_id", sessionId);
    console.warn(`[games/settle] session ${sessionId} was already settled on-chain; marked settled locally`);
    return true;
  } catch (err: any) {
    console.error(`[games/settle] could not check on-chain settled state for ${sessionId}:`, err?.message ?? err);
    return false;
  }
}

async function reconcileExistingSettlementTx(row: SkillGameSessionRow) {
  if (!row.settle_tx_hash) return { pending: false, settled: false, failed: false };

  try {
    const receipt = await provider.getTransactionReceipt(row.settle_tx_hash);
    if (!receipt) {
      return { pending: true, settled: false, failed: false, txHash: row.settle_tx_hash };
    }

    if (receipt.status === 1) {
      await supabase.from("skill_game_sessions").update({
        settled_at: new Date().toISOString(),
      }).eq("session_id", row.session_id);
      return { pending: false, settled: true, failed: false, txHash: row.settle_tx_hash };
    }

    await supabase.from("skill_game_sessions").update({
      settle_tx_hash: null,
    }).eq("session_id", row.session_id);
    row.settle_tx_hash = null;
    return { pending: false, settled: false, failed: true };
  } catch (err: any) {
    console.error(`[games/settle] could not reconcile tx ${row.settle_tx_hash} for session ${row.session_id}:`, err?.message ?? err);
    return { pending: true, settled: false, failed: false, txHash: row.settle_tx_hash };
  }
}

// Atomically claim the right to settle a session across processes/instances.
// Returns true only if this caller acquired the lease. The conditional UPDATE is
// resolved under Postgres row locking, so concurrent claimers serialize and only
// one sees a matching (unsettled, unclaimed-or-stale) row.
//
// Requires a `settle_claimed_at timestamptz` column on skill_game_sessions:
//   alter table skill_game_sessions add column if not exists settle_claimed_at timestamptz;
// Until that migration runs we fail OPEN (claim succeeds) so settlement keeps
// working — the lease only starts protecting once the column exists.
async function tryClaimSettlement(sessionId: string): Promise<boolean> {
  const leaseCutoff = new Date(Date.now() - SETTLE_CLAIM_LEASE_MS).toISOString();
  const { data, error } = await supabase
    .from("skill_game_sessions")
    .update({ settle_claimed_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("settled_at", null)
    .or(`settle_claimed_at.is.null,settle_claimed_at.lt."${leaseCutoff}"`)
    .select("session_id");

  if (error) {
    // Fail OPEN on any error (missing column pre-migration, transient DB issue,
    // etc). The cross-instance lock is an optimization; the contract's one-shot
    // `settled` flag is the real guard against double-pay. Stranding every
    // reward because the lease query errored is far worse than a rare duplicate
    // tx that simply reverts. 42703 = column not yet migrated.
    if ((error as any).code === "42703") {
      console.warn("[games/settle] settle_claimed_at column missing — settling without cross-instance lock");
    } else {
      console.error(`[games/settle] claim errored, proceeding without lock for ${sessionId}:`, error.message ?? error);
    }
    return true;
  }
  return (data?.length ?? 0) > 0;
}

async function queueSettlementForAcceptedRow(row: SkillGameSessionRow, fallback: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  elapsedMs?: number;
}) {
  const result = getResultFromRow(row, fallback);
  if (row.settled_at) {
    return {
      result,
      queued: false,
      settled: true,
      settleTxHash: row.settle_tx_hash ?? undefined,
    };
  }

  if (!verifierPk || !skillGamesAddress) {
    return { result, queued: false, settled: false };
  }

  const priorAttempts = Number(row.settle_attempts ?? 0);
  const numericSessionId = parseSessionId(fallback.sessionId);

  const existingTx = await reconcileExistingSettlementTx(row);
  if (existingTx.settled) {
    return {
      result,
      queued: false,
      settled: true,
      settleTxHash: existingTx.txHash,
    };
  }
  if (existingTx.pending) {
    return {
      result,
      queued: true,
      settled: false,
      settleTxHash: existingTx.txHash,
    };
  }

  if (await markSettledIfOnchain(fallback.sessionId, numericSessionId, priorAttempts)) {
    return { result, queued: false, settled: true };
  }

  if (priorAttempts >= MAX_SETTLE_ATTEMPTS) {
    return { result, queued: false, settled: false };
  }

  // Acquire the cross-instance lease before signing/broadcasting. If another
  // worker holds it, treat as queued — they (or the retry sweep) will finish it.
  if (!(await tryClaimSettlement(fallback.sessionId))) {
    return { result, queued: true, settled: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const score = BigInt(Math.round(Number(row.score ?? 0)));
  const rewardMiles = toMilesUnits(Number(row.reward_miles ?? 0));
  const rewardStable = toStableUnits(Number(row.reward_stable ?? 0));
  let expiry = BigInt(row.settlement_expiry ?? 0);
  let signature = row.settlement_sig;

  if (!signature || Number(expiry) <= nowSec + 60) {
    const signed = await signSettlementPayload({
      sessionId: numericSessionId,
      player: fallback.walletAddress,
      gameType: GAME_TYPE_ID[fallback.gameType],
      score,
      rewardMiles,
      rewardStable,
    });
    expiry = signed.expiry;
    signature = signed.signature;
    await supabase.from("skill_game_sessions").update({
      settlement_sig: signature,
      settlement_expiry: Number(expiry),
    }).eq("session_id", fallback.sessionId);
  }

  void attemptSettle(
    fallback.sessionId,
    numericSessionId,
    score,
    rewardMiles,
    rewardStable,
    expiry,
    signature,
    priorAttempts
  );

  return { result, queued: true, settled: false };
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
    let submittedTxHash: string | null = null;
    try {
      const contract = getSkillGames(false);
      const tx = await contract.settleGame(numericSessionId, score, rewardMiles, rewardStable, expiry, signature);
      submittedTxHash = tx.hash;
      await supabase.from("skill_game_sessions").update({
        settle_tx_hash: tx.hash,
        settle_attempts: totalAttempts,
      }).eq("session_id", sessionId);

      const receipt: any = await withTimeout(tx.wait(1), SETTLE_RECEIPT_TIMEOUT_MS);
      if (!receipt) {
        console.warn(`[games/settle] session ${sessionId} tx=${tx.hash} still pending after ${SETTLE_RECEIPT_TIMEOUT_MS}ms`);
        return false;
      }
      if (receipt.status === 0) {
        throw new Error("settlement-tx-reverted");
      }

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
      if (submittedTxHash) {
        try {
          await supabase.from("skill_game_sessions")
            .update({ settle_tx_hash: submittedTxHash })
            .eq("session_id", sessionId);
        } catch { /* best effort */ }
      }
      if (await markSettledIfOnchain(sessionId, numericSessionId, totalAttempts)) {
        return "already-settled";
      }

      // Increment total attempt count so the retry cron can bound retries correctly
      await supabase.from("skill_game_sessions")
        .update({ settle_attempts: totalAttempts })
        .eq("session_id", sessionId);

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
    const { data, error } = await supabase
      .from("skill_game_sessions")
      .select("session_id, wallet_address, game_type, score, reward_miles, reward_stable, accepted, anti_abuse_flags, seed_commitment, settle_tx_hash, settle_attempts, settled_at, settlement_sig, settlement_expiry")
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

      await queueSettlementForAcceptedRow(row as SkillGameSessionRow, {
        sessionId: row.session_id,
        walletAddress: row.wallet_address,
        gameType: row.game_type,
      });
    }
  } finally {
    retryPendingSettlementsRunning = false;
  }
}

setTimeout(() => { void retryPendingSettlements(); }, 5000);
setInterval(() => { void retryPendingSettlements(); }, SETTLE_RETRY_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Server-authoritative Memory Flip
//
// The shuffled deck lives only in skill_game_server_sessions and is never sent
// to the client unflipped. The client flips one index at a time; the server
// reveals just that card's value and tracks all state + timing on its own clock.
// Because the board is never disclosed up front, knowing the seed/commitment
// gives a cheater nothing — memory is the only way to clear the board.
// ---------------------------------------------------------------------------

const SETTLE_ROW_COLUMNS =
  "session_id, wallet_address, game_type, score, reward_miles, reward_stable, accepted, anti_abuse_flags, seed_commitment, settle_tx_hash, settle_attempts, settled_at, settlement_sig, settlement_expiry";

// Per-session in-process serialization so concurrent flips on the same session
// don't interleave. Cross-instance safety comes from the optimistic `version`
// guard on each write (a stale write loses and the client retries).
const serverSessionLocks = new Map<string, Promise<unknown>>();
function withServerSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = serverSessionLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  serverSessionLocks.set(sessionId, run);
  void run.catch(() => undefined).finally(() => {
    if (serverSessionLocks.get(sessionId) === run) serverSessionLocks.delete(sessionId);
  });
  return run;
}

type ServerSessionRow = {
  session_id: string;
  wallet_address: string;
  game_type: string;
  server_seed: string;
  server_seed_hash: string;
  deck: string[];
  revealed: number[] | null;
  matched: number[] | null;
  selected: number[] | null;
  action_offsets: number[] | null;
  moves: number | null;
  matches: number | null;
  mistakes: number | null;
  lock_until_ms: number | null;
  started_at_ms: number | string;
  completed: boolean | null;
  finalized: boolean | null;
  version: number;
  // rule_tap-specific
  rule: RuleTapState["rule"] | null;
  timeline: RuleTapState["timeline"] | null;
  counted_targets: string[] | null;
  correct: number | null;
  taps: number | null;
  // penalty_pressure-specific
  shots_taken: number | null;
  goals_scored: number | null;
  pp_streak: number | null;
  total_score: number | null;
  column_history: number[] | null;
  shot_results: ShotRecord[] | null;
};

function stateFromRow(row: ServerSessionRow): MemoryServerState {
  return {
    deck: row.deck,
    revealed: row.revealed ?? [],
    matched: row.matched ?? [],
    selected: row.selected ?? [],
    moves: row.moves ?? 0,
    matches: row.matches ?? 0,
    mistakes: row.mistakes ?? 0,
    lockUntilMs: row.lock_until_ms ?? 0,
    startedAtMs: Number(row.started_at_ms),
    actionOffsets: row.action_offsets ?? [],
    completed: row.completed ?? false,
  };
}

// Optimistic-concurrency write: only succeeds if `version` is unchanged.
async function saveServerState(sessionId: string, state: MemoryServerState, expectedVersion: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_game_server_sessions")
    .update({
      revealed: state.revealed,
      matched: state.matched,
      selected: state.selected,
      action_offsets: state.actionOffsets,
      moves: state.moves,
      matches: state.matches,
      mistakes: state.mistakes,
      lock_until_ms: state.lockUntilMs,
      completed: state.completed,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("version", expectedVersion)
    .select("session_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

function ruleStateFromRow(row: ServerSessionRow): RuleTapState {
  return {
    rule: row.rule as RuleTapState["rule"],
    timeline: (row.timeline ?? []) as RuleTapState["timeline"],
    correct: row.correct ?? 0,
    mistakes: row.mistakes ?? 0,
    taps: row.taps ?? 0,
    countedTargets: row.counted_targets ?? [],
    actionOffsets: row.action_offsets ?? [],
    startedAtMs: Number(row.started_at_ms),
  };
}

// Optimistic-concurrency write for rule_tap live taps.
async function saveRuleTapState(sessionId: string, state: RuleTapState, expectedVersion: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_game_server_sessions")
    .update({
      correct: state.correct,
      mistakes: state.mistakes,
      taps: state.taps,
      counted_targets: state.countedTargets,
      action_offsets: state.actionOffsets,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("version", expectedVersion)
    .select("session_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function savePenaltyState(
  sessionId: string,
  state: ReturnType<typeof stateFromPenaltyRow>,
  expectedVersion: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_game_server_sessions")
    .update({
      shots_taken:    state.shotsTaken,
      goals_scored:   state.goalsScored,
      pp_streak:      state.streak,
      total_score:    state.totalScore,
      column_history: state.columnHistory,
      shot_results:   state.shotResults,
      completed:      state.shotsTaken >= PENALTY_SHOTS,
      version:        expectedVersion + 1,
      updated_at:     new Date().toISOString(),
    })
    .eq("session_id", sessionId)
    .eq("version", expectedVersion)
    .select("session_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function createPenaltyServerSessionFromChain(input: {
  sessionId: string;
  walletAddress: string;
}): Promise<ServerSessionRow> {
  const onchain = await assertActiveOnchainSession({
    sessionId: input.sessionId,
    walletAddress: input.walletAddress,
    gameType: "penalty_pressure",
  });
  if (onchain.settled) {
    const err = new Error("session-already-settled-on-chain") as Error & { status?: number };
    err.status = 409;
    throw err;
  }

  const seed = newServerSeed();
  const startedAtMs = Date.now();
  const initState = newPenaltyState(startedAtMs);

  const insert = {
    session_id: input.sessionId,
    wallet_address: input.walletAddress.toLowerCase(),
    game_type: "penalty_pressure",
    server_seed: seed,
    server_seed_hash: serverSeedHash(seed),
    deck: [],
    started_at_ms: startedAtMs,
    shots_taken: initState.shotsTaken,
    goals_scored: initState.goalsScored,
    pp_streak: initState.streak,
    total_score: initState.totalScore,
    column_history: initState.columnHistory,
    shot_results: initState.shotResults,
  };

  const { error: insErr } = await supabase
    .from("skill_game_server_sessions")
    .insert(insert);
  if (insErr && insErr.code !== "23505") throw insErr;

  const { data: row, error: readErr } = await supabase
    .from("skill_game_server_sessions")
    .select("*")
    .eq("session_id", input.sessionId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) {
    const err = new Error("server-session-create-failed") as Error & { status?: number };
    err.status = 500;
    throw err;
  }

  console.log(`[games/session/shot] lazily created penalty_pressure session sid=${input.sessionId}`);
  return row as ServerSessionRow;
}

async function assertActiveOnchainSession(input: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
}): Promise<OnchainSession> {
  const onchain = await readOnchainSession(input.sessionId, { retryOnMissing: true });
  if (!onchain) {
    const err = new Error("session-not-found-on-chain") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (onchain.player !== input.walletAddress.toLowerCase()) {
    const err = new Error("session-player-mismatch") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  if (onchain.gameType !== GAME_TYPE_ID[input.gameType]) {
    const err = new Error("session-game-type-mismatch") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return onchain;
}

router.post("/session/init", async (req, res) => {
  try {
    const { sessionId, walletAddress, gameType } = req.body ?? {};
    if (!sessionId || !walletAddress || !isGameType(gameType)) {
      res.status(400).json({ error: "sessionId, walletAddress and a valid gameType required" });
      return;
    }
    const sid = String(sessionId);
    const wallet = String(walletAddress);
    console.log(`[games/session/init] hit sid=${sid} wallet=${wallet} gameType=${gameType}`);

    const result = await withServerSessionLock(sid, async () => {
      const onchain = await assertActiveOnchainSession({ sessionId: sid, walletAddress: wallet, gameType });
      if (onchain.settled) {
        const err = new Error("session-already-settled-on-chain") as Error & { status?: number };
        err.status = 409;
        throw err;
      }

      const { data: existing, error: readErr } = await supabase
        .from("skill_game_server_sessions")
        .select("game_type, server_seed_hash, started_at_ms, completed, finalized, revealed, matched, selected, moves, matches, mistakes, rule, correct, deck, shots_taken, goals_scored, pp_streak, total_score, column_history, shot_results")
        .eq("session_id", sid)
        .maybeSingle();
      if (readErr) throw readErr;

      if (existing) {
        console.log(`[games/session/init] resume existing sid=${sid} gameType=${existing.game_type} finalized=${existing.finalized}`);
        // Idempotent resume — never returns the secret board (deck/timeline).
        if (existing.game_type === "rule_tap") {
          return {
            gameType: "rule_tap" as const,
            serverSeedHash: existing.server_seed_hash,
            rule: existing.rule,
            durationMs: RULE_TAP_DURATION_MS,
            tickIntervalMs: RULE_TAP_TICK_MS,
            gridSize: RULE_TAP_GRID_SIZE,
            revealLeadMs: RULE_TAP_REVEAL_LEAD_MS,
            startedAtMs: Number(existing.started_at_ms),
            resumed: true,
            finalized: Boolean(existing.finalized),
            state: { correct: existing.correct ?? 0, mistakes: existing.mistakes ?? 0 },
          };
        }
        if (existing.game_type === "penalty_pressure") {
          return {
            gameType: "penalty_pressure" as const,
            serverSeedHash: existing.server_seed_hash,
            shots: PENALTY_SHOTS,
            durationMs: PENALTY_DURATION_MS,
            startedAtMs: Number(existing.started_at_ms),
            resumed: true,
            finalized: Boolean(existing.finalized),
            state: {
              shotsTaken:  existing.shots_taken  ?? 0,
              goalsScored: existing.goals_scored ?? 0,
              totalScore:  existing.total_score  ?? 0,
              completed:   Boolean(existing.completed),
              shotResults: existing.shot_results ?? [],
            },
          };
        }
        return {
          gameType: "memory_flip" as const,
          serverSeedHash: existing.server_seed_hash,
          cardCount: MEMORY_FLIP_CARD_COUNT,
          durationMs: MEMORY_FLIP_DURATION_MS,
          startedAtMs: Number(existing.started_at_ms),
          deck: existing.deck,
          resumed: true,
          finalized: Boolean(existing.finalized),
          state: {
            revealed: existing.revealed ?? [],
            matched: existing.matched ?? [],
            selected: existing.selected ?? [],
            moves: existing.moves ?? 0,
            matches: existing.matches ?? 0,
            mistakes: existing.mistakes ?? 0,
            completed: Boolean(existing.completed),
          },
        };
      }

      const seed = newServerSeed();
      const startedAtMs = Date.now();

      if (gameType === "rule_tap") {
        const { rule, timeline } = buildRuleTapSession(seed);
        const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
          session_id: sid,
          wallet_address: wallet.toLowerCase(),
          game_type: gameType,
          server_seed: seed,
          server_seed_hash: serverSeedHash(seed),
          deck: [],
          rule,
          timeline, // secret — only ever revealed just-in-time via /session/tick
          started_at_ms: startedAtMs,
        });
        if (insErr) throw insErr;
        console.log(`[games/session/init] created rule_tap session sid=${sid} ticks=${timeline.length}`);

        return {
          gameType: "rule_tap" as const,
          serverSeedHash: serverSeedHash(seed),
          rule, // safe to send: without the timeline it grants no precompute
          durationMs: RULE_TAP_DURATION_MS,
          tickIntervalMs: RULE_TAP_TICK_MS,
          gridSize: RULE_TAP_GRID_SIZE,
          revealLeadMs: RULE_TAP_REVEAL_LEAD_MS,
          startedAtMs,
          resumed: false,
        };
      }

      if (gameType === "penalty_pressure") {
        const initState = newPenaltyState(startedAtMs);
        const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
          session_id:     sid,
          wallet_address: wallet.toLowerCase(),
          game_type:      gameType,
          server_seed:    seed,
          server_seed_hash: serverSeedHash(seed),
          deck:           [],
          started_at_ms:  startedAtMs,
          shots_taken:    initState.shotsTaken,
          goals_scored:   initState.goalsScored,
          pp_streak:      initState.streak,
          total_score:    initState.totalScore,
          column_history: initState.columnHistory,
          shot_results:   initState.shotResults,
        });
        if (insErr) throw insErr;
        console.log(`[games/session/init] created penalty_pressure session sid=${sid}`);

        return {
          gameType:      "penalty_pressure" as const,
          serverSeedHash: serverSeedHash(seed),
          shots:         PENALTY_SHOTS,
          durationMs:    PENALTY_DURATION_MS,
          startedAtMs,
          resumed:       false,
        };
      }

      const deck = buildMemoryDeck(seed);
      const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
        session_id: sid,
        wallet_address: wallet.toLowerCase(),
        game_type: gameType,
        server_seed: seed,
        server_seed_hash: serverSeedHash(seed),
        deck,
        started_at_ms: startedAtMs,
      });
      if (insErr) throw insErr;
      console.log(`[games/session/init] created memory_flip session sid=${sid} cards=${deck.length}`);

      return {
        gameType: "memory_flip" as const,
        serverSeedHash: serverSeedHash(seed),
        cardCount: MEMORY_FLIP_CARD_COUNT,
        durationMs: MEMORY_FLIP_DURATION_MS,
        startedAtMs,
        // Hybrid: client renders/matches locally for zero-latency play; the server
        // still scores the mirrored flips authoritatively.
        deck,
        resumed: false,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("[games/session/init] ERROR", { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint, status: err?.status });
    res.status(err?.status ?? 500).json({ error: err?.message ?? "server-error" });
  }
});

router.post("/session/flip", async (req, res) => {
  try {
    const { sessionId, walletAddress, cardIndex, offsetMs } = req.body ?? {};
    if (!sessionId || !walletAddress || !Number.isInteger(cardIndex)) {
      res.status(400).json({ error: "sessionId, walletAddress and integer cardIndex required" });
      return;
    }
    const sid = String(sessionId);
    const wallet = String(walletAddress).toLowerCase();
    const clientOffsetMs = typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : undefined;
    console.log(`[games/session/flip] hit sid=${sid} wallet=${wallet} cardIndex=${cardIndex}`);

    const out = await withServerSessionLock(sid, async () => {
      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) {
        console.warn(`[games/session/flip] session-not-found in skill_game_server_sessions for sid=${sid} — was /session/init persisted for this id?`);
        return { status: 404, body: { error: "session-not-found" } };
      }
      if (row.wallet_address !== wallet) {
        console.warn(`[games/session/flip] wallet-mismatch sid=${sid} rowWallet=${row.wallet_address} reqWallet=${wallet}`);
        return { status: 403, body: { error: "wallet-mismatch" } };
      }
      if (row.finalized) return { status: 409, body: { error: "session-finalized" } };

      const state = stateFromRow(row as ServerSessionRow);
      const result = applyFlip(state, cardIndex, Date.now(), clientOffsetMs);
      if (!result.ok) {
        console.warn(`[games/session/flip] rejected sid=${sid} reason=${result.reason}`);
        return { status: 400, body: { error: result.reason } };
      }

      const saved = await saveServerState(sid, state, (row as ServerSessionRow).version);
      if (!saved) return { status: 409, body: { error: "concurrent-modification" } };

      return {
        status: 200,
        body: {
          value: result.value,
          pair: result.pair ?? null,
          state: result.state,
          completed: result.state.completed,
        },
      };
    });

    if (out.status !== 200) {
      console.warn(`[games/session/flip] -> ${out.status}`, out.body);
    }
    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/session/flip] ERROR", { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint });
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// Rule Tap just-in-time reveal. Returns only tiles whose activation time has
// arrived (plus a tiny render lead). Future tiles are never disclosed, so the
// client cannot read the timeline ahead and script a perfect offline run.
router.post("/session/tick", async (req, res) => {
  try {
    const { sessionId, walletAddress } = req.body ?? {};
    if (!sessionId || !walletAddress) {
      res.status(400).json({ error: "sessionId and walletAddress required" });
      return;
    }
    const sid = String(sessionId);
    const wallet = String(walletAddress).toLowerCase();

    const { data: row, error } = await supabase
      .from("skill_game_server_sessions")
      .select("wallet_address, game_type, timeline, started_at_ms, finalized")
      .eq("session_id", sid)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      console.warn(`[games/session/tick] session-not-found sid=${sid}`);
      res.status(404).json({ error: "session-not-found" });
      return;
    }
    if (row.wallet_address !== wallet) {
      res.status(403).json({ error: "wallet-mismatch" });
      return;
    }
    if (row.game_type !== "rule_tap") {
      res.status(400).json({ error: "wrong-game-type" });
      return;
    }

    const elapsedMs = Date.now() - Number(row.started_at_ms);
    const tiles = revealedTiles(
      (row.timeline ?? []) as RuleTapState["timeline"],
      elapsedMs + RULE_TAP_REVEAL_LEAD_MS
    );
    res.json({ elapsedMs, durationMs: RULE_TAP_DURATION_MS, tiles, finalized: Boolean(row.finalized) });
  } catch (err: any) {
    console.error("[games/session/tick] ERROR", { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint });
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// Rule Tap live tap. The server stamps arrival on its own clock and scores the
// tap against the secret timeline + rule, so all scoring/timing is trustworthy.
router.post("/session/tap", async (req, res) => {
  try {
    const { sessionId, walletAddress, tileIndex, offsetMs } = req.body ?? {};
    if (!sessionId || !walletAddress || !Number.isInteger(tileIndex)) {
      res.status(400).json({ error: "sessionId, walletAddress and integer tileIndex required" });
      return;
    }
    const clientOffsetMs = typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : undefined;
    const sid = String(sessionId);
    const wallet = String(walletAddress).toLowerCase();

    console.log(`[games/session/tap] hit sid=${sid} wallet=${wallet} tileIndex=${tileIndex}`);
    const out = await withServerSessionLock(sid, async () => {
      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) {
        console.warn(`[games/session/tap] session-not-found sid=${sid}`);
        return { status: 404, body: { error: "session-not-found" } };
      }
      if (row.wallet_address !== wallet) return { status: 403, body: { error: "wallet-mismatch" } };
      if (row.game_type !== "rule_tap") return { status: 400, body: { error: "wrong-game-type" } };
      if (row.finalized) return { status: 409, body: { error: "session-finalized" } };

      const state = ruleStateFromRow(row as ServerSessionRow);
      const result = applyTap(state, tileIndex, Date.now(), clientOffsetMs);
      if (!result.ok) return { status: 400, body: { error: result.reason } };

      const saved = await saveRuleTapState(sid, state, (row as ServerSessionRow).version);
      if (!saved) return { status: 409, body: { error: "concurrent-modification" } };

      return {
        status: 200,
        body: {
          hit: result.hit,
          duplicate: result.duplicate,
          correct: result.correct,
          mistakes: result.mistakes,
        },
      };
    });

    if (out.status !== 200) {
      console.warn(`[games/session/tap] -> ${out.status}`, out.body);
    }
    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/session/tap] ERROR", { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint });
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

router.post("/session/shot", async (req, res) => {
  try {
    const { sessionId, walletAddress, zone, normalisedPower } = req.body ?? {};
    if (!sessionId || !walletAddress || !Number.isInteger(zone) || typeof normalisedPower !== "number") {
      res.status(400).json({ error: "sessionId, walletAddress, integer zone (0–5) and normalisedPower required" });
      return;
    }
    const sid    = String(sessionId);
    const wallet = String(walletAddress).toLowerCase();
    console.log(`[games/session/shot] hit sid=${sid} wallet=${wallet} zone=${zone} power=${normalisedPower}`);

    const out = await withServerSessionLock(sid, async () => {
      const { data: existingRow, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      const row = existingRow ?? await createPenaltyServerSessionFromChain({
        sessionId: sid,
        walletAddress: wallet,
      });
      if (!row) {
        console.warn(`[games/session/shot] session-not-found sid=${sid}`);
        return { status: 404, body: { error: "session-not-found" } };
      }
      if (row.wallet_address !== wallet) {
        return { status: 403, body: { error: "wallet-mismatch" } };
      }
      if (row.game_type !== "penalty_pressure") {
        return { status: 400, body: { error: "wrong-game-type" } };
      }
      if (row.finalized) return { status: 409, body: { error: "session-finalized" } };

      const state  = stateFromPenaltyRow(row as ServerSessionRow);
      const result = applyShot(state, zone, normalisedPower, Date.now());

      if (!result.ok) {
        console.warn(`[games/session/shot] rejected sid=${sid} reason=${result.reason}`);
        return { status: 400, body: { error: result.reason } };
      }

      const saved = await savePenaltyState(sid, state, (row as ServerSessionRow).version);
      if (!saved) return { status: 409, body: { error: "concurrent-modification" } };

      return {
        status: 200,
        body: {
          goal:         result.goal,
          keeperDiveCol: result.keeperDiveCol,
          points:       result.points,
          state:        result.state,
          completed:    result.completed,
        },
      };
    });

    if (out.status !== 200) console.warn(`[games/session/shot] -> ${out.status}`, out.body);
    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/session/shot] ERROR", { message: err?.message, code: err?.code });
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

router.post("/session/finish", async (req, res) => {
  try {
    const { sessionId, walletAddress } = req.body ?? {};
    if (!sessionId || !walletAddress) {
      res.status(400).json({ error: "sessionId and walletAddress required" });
      return;
    }
    const sid = String(sessionId);
    const wallet = String(walletAddress);
    console.log(`[games/session/finish] hit sid=${sid} wallet=${wallet}`);

    const out = await withServerSessionLock(sid, async () => {
      const { data: row, error } = await supabase
        .from("skill_game_server_sessions")
        .select("*")
        .eq("session_id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!row) {
        console.warn(`[games/session/finish] session-not-found sid=${sid}`);
        return { status: 404, body: { error: "session-not-found" } };
      }
      if (row.wallet_address !== wallet.toLowerCase()) return { status: 403, body: { error: "wallet-mismatch" } };

      const gameType: GameType =
        row.game_type === "rule_tap"        ? "rule_tap"        :
        row.game_type === "penalty_pressure" ? "penalty_pressure" :
        "memory_flip";

      // Compute the authoritative result from server-held state, and the
      // game-specific extras for the response body.
      let final: { accepted: boolean; score: number; rewardMiles: number; rewardStable: number; completed: boolean; elapsedMs: number; flags: string[] };
      let extra: Record<string, number>;
      if (gameType === "rule_tap") {
        const f = finalizeRuleTap(ruleStateFromRow(row as ServerSessionRow), Date.now());
        final = f;
        extra = { correct: f.correct, mistakes: f.mistakes };
      } else if (gameType === "penalty_pressure") {
        const f = finalizePenaltyPressure(stateFromPenaltyRow(row as ServerSessionRow), Date.now());
        final = f;
        extra = { goalsScored: f.goalsScored, shotsTaken: f.shotsTaken };
      } else {
        const f = finalizeMemoryFlip(stateFromRow(row as ServerSessionRow), Date.now());
        final = f;
        extra = { matches: f.matches, moves: f.moves, mistakes: f.mistakes };
      }

      if (!row.finalized) {
        await supabase.from("skill_game_server_sessions").update({
          finalized: true,
          completed: final.completed,
          score: final.score,
          updated_at: new Date().toISOString(),
        }).eq("session_id", sid);
      }

      let settlement = { queued: false, settled: false, settleTxHash: undefined as string | undefined };
      const onchain = await readOnchainSession(sid);
      const hasReward = final.rewardMiles > 0 || final.rewardStable > 0;

      // Record the result in the settlement-bearing table for history + leaderboard.
      await supabase.from("skill_game_sessions").upsert({
        session_id: sid,
        wallet_address: wallet.toLowerCase(),
        game_type: gameType,
        score: final.score,
        reward_miles: final.accepted ? final.rewardMiles : 0,
        reward_stable: final.accepted ? final.rewardStable : 0,
        accepted: final.accepted,
        anti_abuse_flags: final.flags,
        seed_commitment: onchain?.seedCommitment ?? null,
      });

      // Only settle on-chain when there's something to mint and the session is live.
      if (final.accepted && hasReward && onchain && !onchain.settled && verifierPk && skillGamesAddress) {
        const { data: settleRow, error: selErr } = await supabase
          .from("skill_game_sessions")
          .select(SETTLE_ROW_COLUMNS)
          .eq("session_id", sid)
          .maybeSingle();
        if (selErr) throw selErr;
        if (settleRow) {
          const s = await queueSettlementForAcceptedRow(settleRow as SkillGameSessionRow, {
            sessionId: sid,
            walletAddress: wallet,
            gameType,
          });
          settlement = { queued: s.queued, settled: s.settled, settleTxHash: s.settleTxHash ?? undefined };
        }
      }

      return {
        status: 200,
        body: {
          accepted: final.accepted,
          score: final.score,
          rewardMiles: final.accepted ? final.rewardMiles : 0,
          rewardStable: final.accepted ? final.rewardStable : 0,
          completed: final.completed,
          elapsedMs: final.elapsedMs,
          antiAbuseFlags: final.flags,
          ...extra,
          // Provable fairness: client can rebuild the board from the revealed seed.
          serverSeed: row.server_seed,
          serverSeedHash: row.server_seed_hash,
          ...settlement,
        },
      };
    });

    res.status(out.status).json(out.body);
  } catch (err: any) {
    console.error("[games/session/finish] ERROR", { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint });
    res.status(err?.status ?? 500).json({ error: err?.message ?? "server-error" });
  }
});

export default router;
