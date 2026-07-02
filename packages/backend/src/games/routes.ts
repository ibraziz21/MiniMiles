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
import {
  type SettlementJobRow,
  getSettlementJob,
  leaseSettlementJobs,
  markJobConfirmed,
  markJobRetrying,
  markJobSubmitted,
  upsertSettlementJob,
} from "./settlementJobs";
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
import type { GameReplay, GameType, MemoryFlipReplay, RuleTapReplay } from "./types";

const router = Router();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220n;

// ethers v6 FallbackProvider has a known bug where its internal network-consensus
// check throws "network changed" on every call. Instead, we implement a simple
// sequential retry: create a fresh JsonRpcProvider per attempt and try each URL
// in order until one succeeds. staticNetwork skips the eth_chainId round-trip.
const CELO_NETWORK = { chainId: 42220, name: "celo" };
const CELO_RPCS = [...new Set([
  CELO_RPC,
  "https://rpc.ankr.com/celo",
  "https://celo.drpc.org",
])];

// Stable provider for write operations (signing, settlement broadcasts).
const provider = new JsonRpcProvider(CELO_RPCS[0], CELO_NETWORK, { staticNetwork: true });

// For read-only calls, try each RPC in order and return the first success.
async function readWithFallback<T>(fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const url of CELO_RPCS) {
    try {
      return await fn(new JsonRpcProvider(url, CELO_NETWORK, { staticNetwork: true }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
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
  const session = await readWithFallback((p) => {
    if (!skillGamesAddress) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set");
    return new Contract(skillGamesAddress, akibaSkillGamesAbi, p).sessions(numericSessionId);
  });
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
    const [status, nonce] = await readWithFallback((p) => {
      if (!skillGamesAddress) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set");
      const contract = new Contract(skillGamesAddress, akibaSkillGamesAbi, p);
      return Promise.all([
        contract.playerStatus(wallet, GAME_TYPE_ID[gameType]),
        contract.startNonces(wallet),
      ]);
    });
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

    const receipt = await readWithFallback((p) => p.getTransactionReceipt(txHash));
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

    // Check the Phase-3 job table first; fall back to legacy fields if no job exists.
    let jobRow: SettlementJobRow | null = null;
    try {
      jobRow = await getSettlementJob(sessionId);
    } catch (err: any) {
      if ((err as any)?.code !== "42P01") {
        console.warn("[games/settlement-status] job lookup failed:", err?.message);
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const settlementExpiry = Number(data.settlement_expiry ?? 0);
    const isSettled = Boolean(data.settled_at) || jobRow?.status === "confirmed";

    res.json({
      sessionId: data.session_id,
      accepted: Boolean(data.accepted),
      settled: isSettled,
      settleTxHash: jobRow?.tx_hash ?? data.settle_tx_hash,
      settledAt: data.settled_at,
      settleAttempts: jobRow?.attempts ?? Number(data.settle_attempts ?? 0),
      settlementExpired: settlementExpiry > 0 && settlementExpiry <= nowSec,
      retryable: jobRow
        ? ["queued", "retrying"].includes(jobRow.status)
        : Boolean(data.accepted) && !data.settled_at && Number(data.settle_attempts ?? 0) < MAX_SETTLE_ATTEMPTS,
      rewardMiles: Number(data.reward_miles ?? 0),
      rewardStable: Number(data.reward_stable ?? 0),
      antiAbuseFlags: data.anti_abuse_flags ?? [],
      ...(jobRow ? { jobStatus: jobRow.status, lastError: jobRow.last_error } : {}),
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
    const bal = await readWithFallback((p) => p.getBalance(wallet.address));
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
    const receipt = await readWithFallback((p) => p.getTransactionReceipt(row.settle_tx_hash!));
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

// ---------------------------------------------------------------------------
// Phase 3: job-table-based settlement worker
// ---------------------------------------------------------------------------

const WORKER_ID = `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

async function reconcileJobTx(txHash: string): Promise<"pending" | "success" | "reverted" | "error"> {
  try {
    const receipt = await readWithFallback((p) => p.getTransactionReceipt(txHash));
    if (!receipt) return "pending";
    return (receipt as any).status === 1 ? "success" : "reverted";
  } catch {
    return "error";
  }
}

async function processSettlementJob(job: SettlementJobRow): Promise<void> {
  if (!verifierPk || !skillGamesAddress) return;

  const sid = job.session_id;
  const numericSid = BigInt(sid);
  const attempts = job.attempts + 1;

  // Already settled on-chain? Short-circuit.
  const alreadyOnchain = await markSettledIfOnchain(sid, numericSid, attempts);
  if (alreadyOnchain) {
    await markJobConfirmed(job.id, job.tx_hash ?? "already-settled-onchain", attempts);
    return;
  }

  // Check if already settled in DB (inline settlement won the race).
  const { data: regRow } = await supabase
    .from("skill_game_sessions")
    .select("settled_at, settle_tx_hash")
    .eq("session_id", sid)
    .maybeSingle();
  if (regRow?.settled_at) {
    await markJobConfirmed(job.id, regRow.settle_tx_hash ?? "already-settled-db", attempts);
    return;
  }

  // Reconcile an in-flight tx if one was submitted previously.
  if (job.tx_hash) {
    const txState = await reconcileJobTx(job.tx_hash);
    if (txState === "pending") {
      // Still in-flight — release lease so the next sweep re-checks.
      await markJobRetrying(job.id, "tx-pending", job.attempts);
      return;
    }
    if (txState === "success") {
      await supabase
        .from("skill_game_sessions")
        .update({ settled_at: new Date().toISOString() })
        .eq("session_id", sid);
      await markJobConfirmed(job.id, job.tx_hash, attempts);
      return;
    }
    // Reverted or error — clear the stale hash and retry with a fresh tx.
    await supabase
      .from("skill_game_settlement_jobs")
      .update({ tx_hash: null, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  }

  try {
    const score        = BigInt(Math.round(job.score));
    const rewardMiles  = toMilesUnits(job.reward_miles);
    const rewardStable = toStableUnits(Number(job.reward_stable));

    const { expiry, signature } = await signSettlementPayload({
      sessionId: numericSid,
      player:    job.wallet_address,
      gameType:  GAME_TYPE_ID[job.game_type as keyof typeof GAME_TYPE_ID] ?? 0,
      score,
      rewardMiles,
      rewardStable,
    });

    const contract = getSkillGames(false);
    const tx = await contract.settleGame(numericSid, score, rewardMiles, rewardStable, expiry, signature);

    await markJobSubmitted(job.id, tx.hash as string, attempts);
    await supabase
      .from("skill_game_sessions")
      .update({ settle_tx_hash: tx.hash, settle_attempts: attempts })
      .eq("session_id", sid);

    const receipt = await withTimeout(tx.wait(1), SETTLE_RECEIPT_TIMEOUT_MS);
    if (!receipt) {
      await markJobRetrying(job.id, "receipt-timeout", attempts);
      return;
    }
    if ((receipt as any).status === 0) throw new Error("settlement-tx-reverted");

    await supabase
      .from("skill_game_sessions")
      .update({ settled_at: new Date().toISOString(), settle_tx_hash: tx.hash, settle_attempts: attempts })
      .eq("session_id", sid);
    await markJobConfirmed(job.id, tx.hash as string, attempts);
    console.log(`[games/settle-jobs] ✅ job ${job.id} session ${sid} settled tx=${tx.hash}`);
  } catch (err: any) {
    const msg = err?.shortMessage ?? err?.message ?? String(err);
    console.error(`[games/settle-jobs] job ${job.id} session ${sid} failed (attempt ${attempts}):`, msg);
    await markJobRetrying(job.id, msg, attempts);
    await supabase
      .from("skill_game_sessions")
      .update({ settle_attempts: attempts })
      .eq("session_id", sid);
    if (msg.includes("insufficient funds")) {
      console.error("[games/settle-jobs] ❌ VERIFIER OUT OF GAS");
      void checkVerifierBalance();
    }
  }
}

let settlementJobsRunning = false;

async function runSettlementJobs(): Promise<void> {
  if (!verifierPk || !skillGamesAddress) return;
  if (settlementJobsRunning) return;
  settlementJobsRunning = true;
  try {
    let jobs: SettlementJobRow[];
    try {
      jobs = await leaseSettlementJobs(WORKER_ID, 5);
    } catch (err: any) {
      if ((err as any)?.code === "42P01") return; // table not yet migrated
      throw err;
    }
    for (const job of jobs) {
      void processSettlementJob(job).catch((err) =>
        console.error(`[games/settle-jobs] unhandled error for job ${job.id}:`, err?.message ?? err)
      );
    }
  } finally {
    settlementJobsRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Legacy settlement retry (skill_game_sessions-based, pre-Phase-3 sessions)
// ---------------------------------------------------------------------------

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

// Legacy retry (pre-Phase-3 sessions without a job row)
setTimeout(() => { void retryPendingSettlements(); }, 5000);
setInterval(() => { void retryPendingSettlements(); }, SETTLE_RETRY_INTERVAL_MS);
// Phase-3 job-table worker (staggered start to avoid thundering herd)
setTimeout(() => { void runSettlementJobs(); }, 8000);
setInterval(() => { void runSettlementJobs(); }, SETTLE_RETRY_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Server-authoritative Memory Flip (hybrid mode)
//
// The deck is built server-side from a secret seed and sent to the client on
// /session/init so the client can render matches at zero latency. The server
// mirrors every flip via /session/flip and scores authoritatively — the client
// cannot report a false result because the server holds the source of truth.
// This is hybrid mode: the board transits once on init, but gameplay scoring
// stays server-side.
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
        .select("game_type, server_seed_hash, started_at_ms, completed, finalized, revealed, matched, selected, moves, matches, mistakes, rule, correct, deck")
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

      const gameType: GameType = row.game_type === "rule_tap" ? "rule_tap" : "memory_flip";

      // Compute the authoritative result from server-held state, and the
      // game-specific extras for the response body.
      let final: { accepted: boolean; score: number; rewardMiles: number; rewardStable: number; completed: boolean; elapsedMs: number; flags: string[] };
      let extra: Record<string, number>;
      if (gameType === "rule_tap") {
        const f = finalizeRuleTap(ruleStateFromRow(row as ServerSessionRow), Date.now());
        final = f;
        extra = { correct: f.correct, mistakes: f.mistakes };
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

      // Phase 3: ensure a durable settlement job exists so the worker can
      // retry if the inline attempt above failed or was skipped (e.g. verifier
      // not configured yet). Non-fatal — legacy retry still covers old sessions.
      if (final.accepted && hasReward) {
        try {
          await upsertSettlementJob({
            sessionId:    sid,
            walletAddress: wallet,
            gameType,
            score:        final.score,
            rewardMiles:  final.accepted ? final.rewardMiles : 0,
            rewardStable: final.accepted ? final.rewardStable : 0,
          });
        } catch (jobErr: any) {
          console.warn("[games/session/finish] could not upsert settlement job:", jobErr?.message ?? jobErr);
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

// ---------------------------------------------------------------------------
// GET /games/session/recover?sessionId=...&wallet=...
//
// Returns a structured lifecycle snapshot for a session so the client can
// determine what went wrong and what to do next. Read-only except for one safe
// reconciliation: if an existing settle_tx_hash is already confirmed on-chain,
// we write settled_at so subsequent calls see the correct state.
// ---------------------------------------------------------------------------
router.get("/session/recover", async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId ?? "").trim();
    const wallet    = String(req.query.wallet ?? req.query.walletAddress ?? "").toLowerCase().trim();

    if (!sessionId || !wallet) {
      res.status(400).json({ error: "sessionId and wallet required" });
      return;
    }

    // 1. On-chain session (best-effort; RPC might be down)
    let onchain: OnchainSession | null = null;
    let onchainErr: string | undefined;
    try {
      onchain = await readOnchainSession(sessionId);
    } catch (err: any) {
      onchainErr = err?.message ?? "rpc-unavailable";
    }

    // Wallet ownership check — enforce via whichever source we have.
    if (onchain && onchain.player !== wallet) {
      res.status(403).json({ error: "wallet-mismatch" });
      return;
    }

    // 2. Registered session (skill_game_sessions)
    const { data: regRow, error: regErr } = await supabase
      .from("skill_game_sessions")
      .select("session_id, wallet_address, game_type, accepted, score, reward_miles, reward_stable, anti_abuse_flags, settle_tx_hash, settled_at, settle_attempts, settlement_expiry")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (regErr) throw regErr;

    if (!onchain && regRow && (regRow as any).wallet_address !== wallet) {
      res.status(403).json({ error: "wallet-mismatch" });
      return;
    }
    if (!onchain && !regRow) {
      res.status(404).json({ error: "session-not-found" });
      return;
    }

    // 3. Server session (skill_game_server_sessions)
    const { data: srvRow, error: srvErr } = await supabase
      .from("skill_game_server_sessions")
      .select("session_id, game_type, finalized, completed, updated_at")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (srvErr) throw srvErr;

    // 4. Settlement job (Phase 3 — table may not exist yet pre-migration)
    let jobRow: SettlementJobRow | null = null;
    try {
      jobRow = await getSettlementJob(sessionId);
    } catch (err: any) {
      if ((err as any)?.code !== "42P01") {
        console.warn("[games/session/recover] settlement job lookup failed:", err?.message);
      }
    }

    // 5. Safe reconciliation: if we have a tx hash not yet marked settled, check chain.
    const r = regRow as any;
    if (r?.settle_tx_hash && !r?.settled_at) {
      try {
        const receipt = await readWithFallback((p) => p.getTransactionReceipt(r.settle_tx_hash)).catch(() => null);
        if ((receipt as any)?.status === 1) {
          await supabase
            .from("skill_game_sessions")
            .update({ settled_at: new Date().toISOString() })
            .eq("session_id", sessionId);
          r.settled_at = new Date().toISOString();
          if (jobRow && jobRow.status !== "confirmed") {
            await markJobConfirmed(jobRow.id, r.settle_tx_hash, jobRow.attempts);
            jobRow = { ...jobRow, status: "confirmed", tx_hash: r.settle_tx_hash };
          }
        }
      } catch { /* best-effort — don't break recovery on reconcile error */ }
    }

    // 6. Derive settlement state
    const settled    = Boolean(r?.settled_at) || onchain?.settled === true;
    const accepted   = Boolean(r?.accepted);
    const rewardMiles = Number(r?.reward_miles ?? 0);
    const rewardStable = Number(r?.reward_stable ?? 0);
    const hasReward  = rewardMiles > 0 || rewardStable > 0;
    const txHash     = jobRow?.tx_hash ?? r?.settle_tx_hash ?? null;
    const attempts   = jobRow?.attempts ?? Number(r?.settle_attempts ?? 0);

    let settlementState: string;
    let settlementRetryable = false;
    let settlementReason: string | undefined;

    if (jobRow) {
      settlementState    = jobRow.status;
      settlementRetryable = ["queued", "retrying"].includes(jobRow.status);
      settlementReason   = jobRow.last_error ?? undefined;
    } else if (settled) {
      settlementState = "confirmed";
    } else if (!accepted || !hasReward) {
      settlementState = "not_required";
    } else if (!txHash && attempts === 0) {
      settlementState    = "not_started";
      settlementRetryable = true;
    } else if (txHash && !settled) {
      settlementState    = "submitted";
      settlementRetryable = true;
    } else if (attempts > 0 && !txHash) {
      settlementState    = attempts >= MAX_SETTLE_ATTEMPTS ? "manual_review" : "retrying";
      settlementRetryable = attempts < MAX_SETTLE_ATTEMPTS;
    } else if (attempts >= MAX_SETTLE_ATTEMPTS) {
      settlementState   = "manual_review";
      settlementReason  = "max attempts reached";
    } else {
      settlementState = "unknown";
    }

    // 7. Determine next action
    let nextAction: string;
    if (onchainErr && !onchain && !r) {
      nextAction = "unavailable";
    } else if (!onchain) {
      nextAction = r ? "wait_settlement" : "unavailable";
    } else if (!r) {
      nextAction = "register_start";
    } else if (!srvRow) {
      nextAction = "init_session";
    } else if (!srvRow.finalized) {
      nextAction = "finish_session";
    } else if (settled || settlementState === "not_required") {
      nextAction = "complete";
    } else if (settlementState === "manual_review") {
      nextAction = "manual_review";
    } else if (settlementState === "submitted" || settlementState === "leased") {
      nextAction = "wait_settlement";
    } else if (settlementRetryable) {
      nextAction = "retry_settlement";
    } else {
      nextAction = "wait_settlement";
    }

    res.json({
      sessionId,
      wallet,
      ...(onchainErr ? { onchainError: onchainErr } : {}),
      onchain: onchain
        ? {
            exists:       true,
            playerMatches: onchain.player === wallet,
            gameType:     onchain.gameType,
            seedCommitment: onchain.seedCommitment,
            settled:      onchain.settled,
            createdAt:    new Date(onchain.createdAt * 1000).toISOString(),
          }
        : { exists: false },
      registeredSession: r
        ? {
            exists:         true,
            accepted:       Boolean(r.accepted),
            score:          Number(r.score ?? 0),
            rewardMiles:    Number(r.reward_miles ?? 0),
            rewardStable:   Number(r.reward_stable ?? 0),
            antiAbuseFlags: r.anti_abuse_flags ?? [],
            settleTxHash:   r.settle_tx_hash ?? null,
            settledAt:      r.settled_at ?? null,
            settleAttempts: Number(r.settle_attempts ?? 0),
          }
        : { exists: false },
      serverSession: srvRow
        ? {
            exists:      true,
            gameType:    srvRow.game_type,
            initialized: true,
            finalized:   Boolean(srvRow.finalized),
            completed:   Boolean(srvRow.completed),
            updatedAt:   srvRow.updated_at,
          }
        : { exists: false },
      settlement: {
        state:    settlementState,
        retryable: settlementRetryable,
        txHash,
        attempts,
        ...(settlementReason ? { reason: settlementReason } : {}),
        ...(jobRow ? { jobId: jobRow.id, jobStatus: jobRow.status } : {}),
      },
      nextAction,
    });
  } catch (err: any) {
    console.error("[games/session/recover]", err);
    res.status(500).json({ error: err?.message ?? "server-error" });
  }
});

// ---------------------------------------------------------------------------
// GET /games/health
// Structured readiness check for monitoring. Returns 200 when all required
// systems are reachable; 503 when a hard dependency is missing or down.
// Low verifier balance is a warning (degraded) but not a hard failure.
// ---------------------------------------------------------------------------
router.get("/health", async (_req, res) => {
  type Check = { ok: boolean; message?: string };
  const checks: Record<string, Check> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  function addOk(key: string, message?: string) {
    checks[key] = { ok: true, ...(message ? { message } : {}) };
  }
  function addWarn(key: string, message: string) {
    checks[key] = { ok: false, message };
    warnings.push(message);
  }
  function addErr(key: string, message: string) {
    checks[key] = { ok: false, message };
    errors.push(message);
  }

  // Process alive
  addOk("process");

  // Env key presence (values never logged or returned)
  const contractAddr = skillGamesAddress;
  if (process.env.SUPABASE_URL) addOk("env.SUPABASE_URL"); else addErr("env.SUPABASE_URL", "SUPABASE_URL missing");
  if (process.env.SUPABASE_SERVICE_KEY) addOk("env.SUPABASE_SERVICE_KEY"); else addErr("env.SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_KEY missing");
  if (contractAddr) addOk("env.SKILL_GAMES_CONTRACT_ADDRESS"); else addErr("env.SKILL_GAMES_CONTRACT_ADDRESS", "SKILL_GAMES_CONTRACT_ADDRESS not set");
  if (verifierPk) addOk("env.SKILL_GAMES_VERIFIER_PK"); else addWarn("env.SKILL_GAMES_VERIFIER_PK", "SKILL_GAMES_VERIFIER_PK not set — settlement signing disabled");

  // All I/O checks run concurrently
  await Promise.allSettled([
    // Celo RPC reachable, then contract read
    (async () => {
      try {
        await Promise.race([
          readWithFallback((p) => p.getBlockNumber()),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("rpc-timeout")), 6000)),
        ]);
        addOk("celoRpc");
      } catch (err: any) {
        addErr("celoRpc", `Celo RPC unreachable: ${err?.message ?? "unknown"}`);
        return;
      }
      if (!contractAddr) {
        addWarn("contractRead", "contract address not configured");
        return;
      }
      try {
        await Promise.race([
          readWithFallback((p) =>
            new Contract(contractAddr, akibaSkillGamesAbi, p).playerStatus(
              "0x0000000000000000000000000000000000000001",
              1,
            )
          ),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("contract-read-timeout")), 6000)),
        ]);
        addOk("contractRead");
      } catch (err: any) {
        addWarn("contractRead", `playerStatus failed: ${err?.message ?? "unknown"}`);
      }
    })(),

    // Verifier gas balance
    (async () => {
      if (!verifierPk) {
        addWarn("verifierBalance", "verifier key not configured");
        return;
      }
      try {
        const w = new Wallet(verifierPk, provider);
        const bal = await Promise.race([
          readWithFallback((p) => p.getBalance(w.address)),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("balance-timeout")), 6000)),
        ]);
        const celo = Number(bal) / 1e18;
        if (celo < VERIFIER_LOW_BALANCE_CELO) {
          addWarn("verifierBalance", `${celo.toFixed(4)} CELO — top up needed`);
        } else {
          addOk("verifierBalance", `${celo.toFixed(4)} CELO`);
        }
      } catch (err: any) {
        addWarn("verifierBalance", `balance check failed: ${err?.message ?? "unknown"}`);
      }
    })(),

    // skill_game_sessions reachable + pending unsettled count
    (async () => {
      try {
        const { count, error } = await supabase
          .from("skill_game_sessions")
          .select("session_id", { count: "exact", head: true })
          .eq("accepted", true)
          .is("settled_at", null);
        if (error) throw error;
        addOk("supabaseSkillSessions");
        const n = count ?? 0;
        if (n >= 50) {
          addWarn("pendingUnsettled", `${n} sessions — high backlog`);
        } else {
          addOk("pendingUnsettled", `${n} sessions`);
        }
      } catch (err: any) {
        addErr("supabaseSkillSessions", `skill_game_sessions read failed: ${err?.message ?? "unknown"}`);
      }
    })(),

    // skill_game_server_sessions reachable
    (async () => {
      try {
        const { error } = await supabase
          .from("skill_game_server_sessions")
          .select("session_id", { count: "exact", head: true });
        if (error) throw error;
        addOk("supabaseServerSessions");
      } catch (err: any) {
        addErr("supabaseServerSessions", `skill_game_server_sessions unreachable: ${err?.message ?? "unknown"}`);
      }
    })(),

    // settle_claimed_at migration presence
    (async () => {
      try {
        const { error } = await supabase
          .from("skill_game_sessions")
          .select("settle_claimed_at")
          .limit(1);
        if (error && (error as any).code === "42703") {
          addWarn("settleClaimedAtMigration", "column missing — run: alter table skill_game_sessions add column if not exists settle_claimed_at timestamptz");
        } else if (error) {
          addWarn("settleClaimedAtMigration", error.message);
        } else {
          addOk("settleClaimedAtMigration");
        }
      } catch (err: any) {
        addWarn("settleClaimedAtMigration", err?.message ?? "check failed");
      }
    })(),
  ]);

  const ok = errors.length === 0;
  res.status(ok ? 200 : 503).json({
    ok,
    degraded: ok && warnings.length > 0,
    checks,
    warnings,
    errors,
    ts: new Date().toISOString(),
  });
});

export default router;
