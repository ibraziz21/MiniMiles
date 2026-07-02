import crypto from "crypto";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  getBytes,
  id,
  keccak256,
} from "ethers";
import { createPublicClient, fallback, http } from "viem";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabaseClient";
import { GAME_CONFIGS, PER_GAME_DAILY_PLAY_CAP } from "@/lib/games/config";
import { AKIBA_SKILL_GAMES_ADDRESS, akibaSkillGamesAbi, SETTLEMENT_TYPEHASH_PREIMAGE } from "@/lib/games/contracts";
import type { GameType } from "@/lib/games/types";

const SKILL_GAMES_ADDRESS = (process.env.SKILL_GAMES_CONTRACT_ADDRESS ??
  AKIBA_SKILL_GAMES_ADDRESS) as `0x${string}` | undefined;
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220n;
const CELO_NETWORK = { chainId: 42220, name: "celo" };
const CELO_RPCS = [...new Set([CELO_RPC, "https://rpc.ankr.com/celo", "https://celo.drpc.org"])];
const VERIFIER_PK = process.env.SKILL_GAMES_VERIFIER_PK ?? "";
const SETTLEMENT_EXPIRY_SECONDS = Number(process.env.SKILL_GAMES_SETTLEMENT_EXPIRY_SECONDS ?? "3600");

const GAME_TYPE_ID: Record<GameType, number> = { rule_tap: 1, memory_flip: 2 };
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SESSION_ABI = [
  ...akibaSkillGamesAbi,
  {
    type: "function",
    name: "sessions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "sessionId", type: "uint256" },
      { name: "player", type: "address" },
      { name: "gameType", type: "uint8" },
      { name: "entryCost", type: "uint256" },
      { name: "createdAt", type: "uint64" },
      { name: "seedCommitment", type: "bytes32" },
      { name: "settled", type: "bool" },
      { name: "score", type: "uint256" },
      { name: "rewardMiles", type: "uint256" },
      { name: "rewardStable", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

type HandlerResult = { status: number; body: Record<string, any> };
type SettlementResult = { queued: boolean; settled: boolean; settleTxHash?: string };

type OnchainSession = {
  sessionId: string;
  player: string;
  gameType: number;
  createdAt: number;
  seedCommitment: string;
  settled: boolean;
};

type RuleTapTile = {
  id: string;
  index: number;
  color: "blue" | "green" | "red" | "gold";
  kind: "star" | "circle" | "square" | "diamond";
  activeFromMs: number;
  activeToMs: number;
};

type RuleTapRule = {
  target: { color: RuleTapTile["color"]; kind: RuleTapTile["kind"] };
  avoid: { color: RuleTapTile["color"]; kind: RuleTapTile["kind"] };
};

type RuleTapState = {
  rule: RuleTapRule;
  timeline: RuleTapTile[][];
  correct: number;
  mistakes: number;
  taps: number;
  countedTargets: string[];
  actionOffsets: number[];
  startedAtMs: number;
};

type ServerSessionRow = {
  session_id: string;
  wallet_address: string;
  game_type: string;
  server_seed: string;
  server_seed_hash: string;
  deck: string[];
  action_offsets: number[] | null;
  mistakes: number | null;
  started_at_ms: number | string;
  completed: boolean | null;
  finalized: boolean | null;
  version: number;
  rule: RuleTapRule | null;
  timeline: RuleTapTile[][] | null;
  counted_targets: string[] | null;
  correct: number | null;
  taps: number | null;
};

const COLORS: RuleTapTile["color"][] = ["blue", "green", "red", "gold"];
const KINDS: RuleTapTile["kind"][] = ["star", "circle", "square", "diamond"];
const RULE_TAP_DURATION_MS = 20_000;
const RULE_TAP_MIN_COMPLETION_MS = 18_000;
const RULE_TAP_TICK_MS = 500;
const RULE_TAP_GRID_SIZE = 9;
const RULE_TAP_REVEAL_LEAD_MS = 250;
const TILE_ACTIVE_MS = 850;
const TILE_WINDOW_TOLERANCE_MS = 120;
const TAP_ARRIVAL_TOLERANCE_MS = 250;
const MIN_INTER_TAP_MS = 90;
const CLIENT_OFFSET_TOLERANCE_MS = 500;

const serverSessionLocks = new Map<string, Promise<unknown>>();

function isGameType(value: unknown): value is GameType {
  return value === "rule_tap" || value === "memory_flip";
}

function getPublicClient() {
  if (!SKILL_GAMES_ADDRESS) throw new Error("SKILL_GAMES_CONTRACT_ADDRESS not set");
  return createPublicClient({
    chain: celo,
    transport: fallback(CELO_RPCS.map((url) => http(url))),
  });
}

function getEthersProvider() {
  return new JsonRpcProvider(CELO_RPCS[0], CELO_NETWORK, { staticNetwork: true });
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

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function getSessionField(raw: any, name: string, index: number) {
  return raw?.[name] ?? raw?.[index];
}

async function readOnchainSessionOnce(sessionId: string | bigint): Promise<OnchainSession | null> {
  const pub = getPublicClient();
  const raw = await pub.readContract({
    address: SKILL_GAMES_ADDRESS!,
    abi: SESSION_ABI,
    functionName: "sessions",
    args: [parseSessionId(sessionId)],
  }) as any;

  const storedSessionId = BigInt(getSessionField(raw, "sessionId", 0));
  const player = String(getSessionField(raw, "player", 1)).toLowerCase();
  if (storedSessionId === 0n || player === ZERO_ADDRESS) return null;

  return {
    sessionId: storedSessionId.toString(),
    player,
    gameType: Number(getSessionField(raw, "gameType", 2)),
    createdAt: Number(getSessionField(raw, "createdAt", 4)),
    seedCommitment: String(getSessionField(raw, "seedCommitment", 5)).toLowerCase(),
    settled: Boolean(getSessionField(raw, "settled", 6)),
  };
}

async function readOnchainSession(sessionId: string | bigint, retryOnMissing = false): Promise<OnchainSession | null> {
  const attempts = retryOnMissing ? 4 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const found = await readOnchainSessionOnce(sessionId);
    if (found) return found;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

function assertOnchainSessionMatches(input: {
  onchain: OnchainSession | null;
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  seedCommitment?: string;
}) {
  if (!input.onchain) return "session-not-found-on-chain";
  if (input.onchain.sessionId !== input.sessionId) return "session-id-mismatch";
  if (input.onchain.player !== input.walletAddress.toLowerCase()) return "session-player-mismatch";
  if (input.onchain.gameType !== GAME_TYPE_ID[input.gameType]) return "session-game-type-mismatch";
  if (input.seedCommitment && input.onchain.seedCommitment !== input.seedCommitment.toLowerCase()) {
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

function withServerSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = serverSessionLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  serverSessionLocks.set(sessionId, run);
  void run.catch(() => undefined).finally(() => {
    if (serverSessionLocks.get(sessionId) === run) serverSessionLocks.delete(sessionId);
  });
  return run;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

function serverSeedHash(seed: string) {
  return keccak256(new TextEncoder().encode(seed));
}

function buildRuleTapSession(serverSeed: string): { rule: RuleTapRule; timeline: RuleTapTile[][] } {
  const rng = createRng(serverSeed);
  const target = {
    color: COLORS[Math.floor(rng() * COLORS.length)],
    kind: KINDS[Math.floor(rng() * KINDS.length)],
  };
  const avoid = {
    color: COLORS[Math.floor(rng() * COLORS.length)],
    kind: KINDS[Math.floor(rng() * KINDS.length)],
  };
  const timeline: RuleTapTile[][] = [];
  for (let tick = 0; tick < 40; tick++) {
    const activeCount = 1 + Math.floor(rng() * 3);
    const used = new Set<number>();
    const tiles: RuleTapTile[] = [];
    for (let i = 0; i < activeCount; i++) {
      let index = Math.floor(rng() * RULE_TAP_GRID_SIZE);
      while (used.has(index)) index = Math.floor(rng() * RULE_TAP_GRID_SIZE);
      used.add(index);
      const forceTarget = rng() > 0.56;
      const forceAvoid = !forceTarget && rng() > 0.72;
      const color = forceTarget ? target.color : forceAvoid ? avoid.color : COLORS[Math.floor(rng() * COLORS.length)];
      const kind = forceTarget ? target.kind : forceAvoid ? avoid.kind : KINDS[Math.floor(rng() * KINDS.length)];
      const activeFromMs = tick * RULE_TAP_TICK_MS;
      tiles.push({
        id: `${tick}-${index}`,
        index,
        color,
        kind,
        activeFromMs,
        activeToMs: activeFromMs + TILE_ACTIVE_MS,
      });
    }
    timeline.push(tiles);
  }
  return { rule: { target, avoid }, timeline };
}

function revealedTiles(timeline: RuleTapTile[][], uptoOffsetMs: number) {
  return timeline.flat().filter((tile) => tile.activeFromMs <= uptoOffsetMs);
}

function activationKey(tile: RuleTapTile) {
  return `${tile.activeFromMs}:${tile.activeToMs}:${tile.index}:${tile.color}:${tile.kind}`;
}

function matchesRule(tile: RuleTapTile | undefined, rule: RuleTapRule): tile is RuleTapTile {
  return !!tile && tile.color === rule.target.color && tile.kind === rule.target.kind;
}

function tileActiveAt(timeline: RuleTapTile[][], offsetMs: number, index: number) {
  return timeline
    .flat()
    .find((tile) =>
      tile.index === index &&
      offsetMs >= tile.activeFromMs &&
      offsetMs <= tile.activeToMs + TILE_WINDOW_TOLERANCE_MS
    );
}

function ruleStateFromRow(row: ServerSessionRow): RuleTapState {
  return {
    rule: row.rule as RuleTapRule,
    timeline: row.timeline ?? [],
    correct: row.correct ?? 0,
    mistakes: row.mistakes ?? 0,
    taps: row.taps ?? 0,
    countedTargets: row.counted_targets ?? [],
    actionOffsets: row.action_offsets ?? [],
    startedAtMs: Number(row.started_at_ms),
  };
}

function applyTap(state: RuleTapState, tileIndex: number, nowMs: number, clientOffsetMs?: number) {
  const serverOffsetMs = nowMs - state.startedAtMs;
  let offsetMs = serverOffsetMs;
  if (typeof clientOffsetMs === "number" && Number.isFinite(clientOffsetMs)) {
    offsetMs = Math.max(0, Math.min(clientOffsetMs, serverOffsetMs + CLIENT_OFFSET_TOLERANCE_MS));
  }
  if (offsetMs < 0 || offsetMs > RULE_TAP_DURATION_MS + TAP_ARRIVAL_TOLERANCE_MS) {
    return { ok: false as const, reason: "session-expired" };
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= RULE_TAP_GRID_SIZE) {
    return { ok: false as const, reason: "invalid-tile-index" };
  }

  state.taps += 1;
  state.actionOffsets.push(offsetMs);

  const tile = tileActiveAt(state.timeline, offsetMs, tileIndex);
  if (matchesRule(tile, state.rule)) {
    const key = activationKey(tile);
    if (state.countedTargets.includes(key)) {
      return { ok: true as const, hit: true, duplicate: true, correct: state.correct, mistakes: state.mistakes };
    }
    state.countedTargets.push(key);
    state.correct += 1;
    return { ok: true as const, hit: true, duplicate: false, correct: state.correct, mistakes: state.mistakes };
  }

  state.mistakes += 1;
  return { ok: true as const, hit: false, duplicate: false, correct: state.correct, mistakes: state.mistakes };
}

function scoreRuleTap(correct: number, mistakes: number) {
  return Math.max(0, correct - mistakes * 2);
}

function rewardForScore(gameType: GameType, score: number) {
  const thresholds = [...GAME_CONFIGS[gameType].thresholds].sort((a, b) => b.minScore - a.minScore);
  const achieved = thresholds.find((threshold) => score >= threshold.minScore);
  return {
    rewardMiles: achieved?.miles ?? 0,
    rewardStable: achieved?.stable ?? 0,
  };
}

function finalizeRuleTap(state: RuleTapState, nowMs: number) {
  const elapsedMs = Math.min(RULE_TAP_DURATION_MS, Math.max(0, nowMs - state.startedAtMs));
  const completed = elapsedMs >= RULE_TAP_MIN_COMPLETION_MS;
  const flags: string[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < state.actionOffsets.length; i++) {
    intervals.push(state.actionOffsets[i] - state.actionOffsets[i - 1]);
  }
  if (intervals.length >= 8 && intervals.every((gap) => gap < MIN_INTER_TAP_MS)) {
    flags.push("sustained_machine_speed_inputs");
  }
  if (intervals.length >= 8 && new Set(intervals.slice(-8)).size <= 2) {
    flags.push("repeated_exact_timing_pattern");
  }

  const score = scoreRuleTap(state.correct, state.mistakes);
  const accepted = !flags.includes("sustained_machine_speed_inputs");
  const reward = rewardForScore("rule_tap", score);
  return {
    accepted,
    score,
    rewardMiles: accepted ? reward.rewardMiles : 0,
    rewardStable: accepted ? reward.rewardStable : 0,
    completed,
    correct: state.correct,
    mistakes: state.mistakes,
    elapsedMs,
    flags,
  };
}

async function saveRuleTapState(sessionId: string, state: RuleTapState, expectedVersion: number) {
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

function toMilesUnits(miles: number) {
  return BigInt(Math.round(miles)) * 10n ** 18n;
}

function toStableUnits(usd: number) {
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
  if (!VERIFIER_PK || !SKILL_GAMES_ADDRESS) throw new Error("skill-games-settlement-not-configured");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + SETTLEMENT_EXPIRY_SECONDS);
  const digest = buildSettlementDigest({
    ...params,
    expiry,
    verifyingContract: SKILL_GAMES_ADDRESS,
  });
  const wallet = new Wallet(VERIFIER_PK, getEthersProvider());
  const signature = await wallet.signMessage(getBytes(digest));
  return { expiry, signature };
}

async function submitSettlement(input: {
  sessionId: string;
  walletAddress: string;
  gameType: GameType;
  score: number;
  rewardMiles: number;
  rewardStable: number;
}) {
  if (!VERIFIER_PK || !SKILL_GAMES_ADDRESS) {
    return { queued: false, settled: false };
  }

  const numericSessionId = parseSessionId(input.sessionId);
  const onchain = await readOnchainSession(input.sessionId).catch(() => null);
  if (onchain?.settled) {
    await supabase
      .from("skill_game_sessions")
      .update({ settled_at: new Date().toISOString() })
      .eq("session_id", input.sessionId);
    return { queued: false, settled: true };
  }

  const score = BigInt(Math.round(input.score));
  const rewardMiles = toMilesUnits(input.rewardMiles);
  const rewardStable = toStableUnits(input.rewardStable);
  const { expiry, signature } = await signSettlementPayload({
    sessionId: numericSessionId,
    player: input.walletAddress,
    gameType: GAME_TYPE_ID[input.gameType],
    score,
    rewardMiles,
    rewardStable,
  });

  await supabase
    .from("skill_game_sessions")
    .update({ settlement_sig: signature, settlement_expiry: Number(expiry) })
    .eq("session_id", input.sessionId);

  const wallet = new Wallet(VERIFIER_PK, getEthersProvider());
  const contract = new Contract(SKILL_GAMES_ADDRESS, akibaSkillGamesAbi as any, wallet);
  const tx = await contract.settleGame(numericSessionId, score, rewardMiles, rewardStable, expiry, signature);
  await supabase
    .from("skill_game_sessions")
    .update({ settle_tx_hash: tx.hash })
    .eq("session_id", input.sessionId);
  return { queued: true, settled: false, settleTxHash: tx.hash as string };
}

export async function localGameStatus(params: URLSearchParams): Promise<HandlerResult> {
  const wallet = String(params.get("wallet") ?? "");
  const gameType = params.get("gameType");
  if (!wallet || !isGameType(gameType)) {
    return { status: 400, body: { error: "wallet and gameType required" } };
  }
  const pub = getPublicClient();
  const [status, nonce] = await Promise.all([
    pub.readContract({
      address: SKILL_GAMES_ADDRESS!,
      abi: akibaSkillGamesAbi,
      functionName: "playerStatus",
      args: [wallet as `0x${string}`, GAME_TYPE_ID[gameType]],
    }) as Promise<readonly [bigint, bigint, bigint]>,
    pub.readContract({
      address: SKILL_GAMES_ADDRESS!,
      abi: akibaSkillGamesAbi,
      functionName: "startNonces",
      args: [wallet as `0x${string}`],
    }) as Promise<bigint>,
  ]);

  return {
    status: 200,
    body: {
      credits: Number(status[0]),
      playsToday: Number(status[1]),
      playsRemaining: Math.min(Number(status[2]), PER_GAME_DAILY_PLAY_CAP),
      dailyCap: PER_GAME_DAILY_PLAY_CAP,
      nonce: Number(nonce),
      contractAvailable: true,
      fallback: "next-local",
    },
  };
}

export async function localRegisterStart(input: {
  sessionId?: unknown;
  walletAddress?: unknown;
  wallet?: unknown;
  gameType?: unknown;
  seedCommitment?: unknown;
}): Promise<HandlerResult> {
  const sessionId = String(input.sessionId ?? "");
  const walletAddress = String(input.walletAddress ?? input.wallet ?? "");
  const gameType = input.gameType;
  const seedCommitment = String(input.seedCommitment ?? "");

  if (!sessionId || !walletAddress || !isGameType(gameType) || !seedCommitment) {
    return { status: 400, body: { error: "sessionId, walletAddress, gameType and seedCommitment required" } };
  }

  const onchain = await readOnchainSession(sessionId, true);
  const mismatch = assertOnchainSessionMatches({ onchain, sessionId, walletAddress, gameType, seedCommitment });
  if (mismatch) return { status: mismatch === "session-not-found-on-chain" ? 404 : 400, body: { error: mismatch } };

  await persistStartedSession({
    sessionId,
    walletAddress,
    gameType,
    seedCommitment,
    createdAt: new Date(onchain!.createdAt * 1000).toISOString(),
  });

  return {
    status: 200,
    body: {
      registered: true,
      sessionId: onchain!.sessionId,
      walletAddress: onchain!.player,
      gameType,
      seedCommitment: onchain!.seedCommitment,
      fallback: "next-local",
    },
  };
}

export async function localSessionAction(action: string, body: any): Promise<HandlerResult | null> {
  if (!["init", "tick", "tap", "finish"].includes(action)) return null;
  if (action === "init") return localSessionInit(body);
  if (action === "tick") return localSessionTick(body);
  if (action === "tap") return localSessionTap(body);
  return localSessionFinish(body);
}

async function localSessionInit(body: any): Promise<HandlerResult> {
  const { sessionId, walletAddress, gameType } = body ?? {};
  if (!sessionId || !walletAddress || !isGameType(gameType)) {
    return { status: 400, body: { error: "sessionId, walletAddress and a valid gameType required" } };
  }
  if (gameType !== "rule_tap") {
    return { status: 503, body: { error: "local-fallback-unsupported-game" } };
  }
  const sid = String(sessionId);
  const wallet = normalizeAddress(String(walletAddress));

  return withServerSessionLock(sid, async () => {
    const onchain = await readOnchainSession(sid, true);
    const mismatch = assertOnchainSessionMatches({ onchain, sessionId: sid, walletAddress: wallet, gameType });
    if (mismatch) return { status: mismatch === "session-not-found-on-chain" ? 404 : 400, body: { error: mismatch } };
    if (onchain!.settled) return { status: 409, body: { error: "session-already-settled-on-chain" } };

    const { data: existing, error: readErr } = await supabase
      .from("skill_game_server_sessions")
      .select("game_type, server_seed_hash, started_at_ms, finalized, rule, correct, mistakes")
      .eq("session_id", sid)
      .maybeSingle();
    if (readErr) throw readErr;

    if (existing) {
      if (existing.game_type !== "rule_tap") return { status: 400, body: { error: "wrong-game-type" } };
      return {
        status: 200,
        body: {
          gameType: "rule_tap",
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
          fallback: "next-local",
        },
      };
    }

    const seed = newServerSeed();
    const startedAtMs = Date.now();
    const { rule, timeline } = buildRuleTapSession(seed);
    const { error: insErr } = await supabase.from("skill_game_server_sessions").insert({
      session_id: sid,
      wallet_address: wallet,
      game_type: gameType,
      server_seed: seed,
      server_seed_hash: serverSeedHash(seed),
      deck: [],
      rule,
      timeline,
      started_at_ms: startedAtMs,
    });
    if (insErr) throw insErr;

    return {
      status: 200,
      body: {
        gameType: "rule_tap",
        serverSeedHash: serverSeedHash(seed),
        rule,
        durationMs: RULE_TAP_DURATION_MS,
        tickIntervalMs: RULE_TAP_TICK_MS,
        gridSize: RULE_TAP_GRID_SIZE,
        revealLeadMs: RULE_TAP_REVEAL_LEAD_MS,
        startedAtMs,
        resumed: false,
        fallback: "next-local",
      },
    };
  });
}

async function localSessionTick(body: any): Promise<HandlerResult> {
  const { sessionId, walletAddress } = body ?? {};
  if (!sessionId || !walletAddress) {
    return { status: 400, body: { error: "sessionId and walletAddress required" } };
  }
  const sid = String(sessionId);
  const wallet = normalizeAddress(String(walletAddress));
  const { data: row, error } = await supabase
    .from("skill_game_server_sessions")
    .select("wallet_address, game_type, timeline, started_at_ms, finalized")
    .eq("session_id", sid)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { status: 404, body: { error: "session-not-found" } };
  if (row.wallet_address !== wallet) return { status: 403, body: { error: "wallet-mismatch" } };
  if (row.game_type !== "rule_tap") return { status: 400, body: { error: "wrong-game-type" } };

  const elapsedMs = Date.now() - Number(row.started_at_ms);
  const tiles = revealedTiles((row.timeline ?? []) as RuleTapTile[][], elapsedMs + RULE_TAP_REVEAL_LEAD_MS);
  return {
    status: 200,
    body: { elapsedMs, durationMs: RULE_TAP_DURATION_MS, tiles, finalized: Boolean(row.finalized), fallback: "next-local" },
  };
}

async function localSessionTap(body: any): Promise<HandlerResult> {
  const { sessionId, walletAddress, tileIndex, offsetMs } = body ?? {};
  if (!sessionId || !walletAddress || !Number.isInteger(tileIndex)) {
    return { status: 400, body: { error: "sessionId, walletAddress and integer tileIndex required" } };
  }
  const sid = String(sessionId);
  const wallet = normalizeAddress(String(walletAddress));
  const clientOffsetMs = typeof offsetMs === "number" && Number.isFinite(offsetMs) ? offsetMs : undefined;

  return withServerSessionLock(sid, async () => {
    const { data: row, error } = await supabase
      .from("skill_game_server_sessions")
      .select("*")
      .eq("session_id", sid)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { status: 404, body: { error: "session-not-found" } };
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
        fallback: "next-local",
      },
    };
  });
}

async function localSessionFinish(body: any): Promise<HandlerResult> {
  const { sessionId, walletAddress } = body ?? {};
  if (!sessionId || !walletAddress) {
    return { status: 400, body: { error: "sessionId and walletAddress required" } };
  }
  const sid = String(sessionId);
  const wallet = normalizeAddress(String(walletAddress));

  return withServerSessionLock(sid, async () => {
    const { data: row, error } = await supabase
      .from("skill_game_server_sessions")
      .select("*")
      .eq("session_id", sid)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { status: 404, body: { error: "session-not-found" } };
    if (row.wallet_address !== wallet) return { status: 403, body: { error: "wallet-mismatch" } };
    if (row.game_type !== "rule_tap") return { status: 503, body: { error: "local-fallback-unsupported-game" } };

    const final = finalizeRuleTap(ruleStateFromRow(row as ServerSessionRow), Date.now());
    if (!row.finalized) {
      await supabase
        .from("skill_game_server_sessions")
        .update({
          finalized: true,
          completed: final.completed,
          score: final.score,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sid);
    }

    const onchain = await readOnchainSession(sid).catch(() => null);
    await supabase.from("skill_game_sessions").upsert({
      session_id: sid,
      wallet_address: wallet,
      game_type: "rule_tap",
      score: final.score,
      reward_miles: final.accepted ? final.rewardMiles : 0,
      reward_stable: final.accepted ? final.rewardStable : 0,
      accepted: final.accepted,
      anti_abuse_flags: final.flags,
      seed_commitment: onchain?.seedCommitment ?? null,
    });

    let settlement: SettlementResult = { queued: false, settled: false };
    const hasReward = final.rewardMiles > 0 || final.rewardStable > 0;
    if (final.accepted && hasReward && onchain && !onchain.settled) {
      try {
        settlement = await submitSettlement({
          sessionId: sid,
          walletAddress: wallet,
          gameType: "rule_tap",
          score: final.score,
          rewardMiles: final.rewardMiles,
          rewardStable: final.rewardStable,
        });
      } catch {
        settlement = { queued: false, settled: false };
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
        correct: final.correct,
        mistakes: final.mistakes,
        serverSeed: (row as ServerSessionRow).server_seed,
        serverSeedHash: (row as ServerSessionRow).server_seed_hash,
        ...settlement,
        fallback: "next-local",
      },
    };
  });
}

export async function localSettlementStatus(params: URLSearchParams): Promise<HandlerResult> {
  const sessionId = String(params.get("sessionId") ?? "");
  const wallet = normalizeAddress(String(params.get("wallet") ?? params.get("walletAddress") ?? ""));
  if (!sessionId || !wallet) return { status: 400, body: { error: "sessionId and wallet required" } };

  const { data: row, error } = await supabase
    .from("skill_game_sessions")
    .select("session_id, wallet_address, accepted, settle_tx_hash, settled_at, settle_attempts")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { status: 404, body: { error: "session-not-found" } };
  if (row.wallet_address !== wallet) return { status: 403, body: { error: "wallet-mismatch" } };

  if (!row.settled_at && row.settle_tx_hash) {
    const receipt = await getPublicClient().getTransactionReceipt({ hash: row.settle_tx_hash as `0x${string}` }).catch(() => null);
    if (receipt?.status === "success") {
      await supabase.from("skill_game_sessions").update({ settled_at: new Date().toISOString() }).eq("session_id", sessionId);
      row.settled_at = new Date().toISOString();
    }
  }

  return {
    status: 200,
    body: {
      accepted: Boolean(row.accepted),
      settled: Boolean(row.settled_at),
      settleTxHash: row.settle_tx_hash ?? null,
      retryable: Number(row.settle_attempts ?? 0) < 12,
      fallback: "next-local",
    },
  };
}
