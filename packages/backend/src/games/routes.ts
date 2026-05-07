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
import { GAME_TYPE_ID, SHARED_DAILY_PLAY_CAP, isGameType } from "./config";
import { akibaSkillGamesAbi, SETTLEMENT_TYPEHASH_PREIMAGE } from "./contracts";
import { seedCommitment, validateMemoryFlipReplay, validateRuleTapReplay } from "./replayValidation";
import type { GameReplay, GameType, MemoryFlipReplay, RuleTapReplay, SettlementPayload } from "./types";

const router = Router();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID = 42220n;
const provider = new JsonRpcProvider(CELO_RPC);
const skillGamesAddress = process.env.SKILL_GAMES_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_AKIBA_SKILL_GAMES_ADDRESS;
const verifierPk = process.env.SKILL_GAMES_VERIFIER_PK;

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

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function countSharedPlaysToday(walletAddress: string) {
  const { count, error } = await supabase
    .from("skill_game_sessions")
    .select("*", { count: "exact", head: true })
    .eq("wallet_address", walletAddress.toLowerCase())
    .gte("created_at", `${todayUtc()}T00:00:00Z`);
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
    status: "started",
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
      playsRemaining: Math.min(Number(status[2]), SHARED_DAILY_PLAY_CAP),
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
    if ((await countSharedPlaysToday(walletAddress)) >= SHARED_DAILY_PLAY_CAP) {
      res.status(429).json({ error: "shared-daily-cap-reached" });
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
    if ((await countSharedPlaysToday(walletAddress)) > SHARED_DAILY_PLAY_CAP) {
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
      .select("seed_commitment")
      .eq("session_id", sessionId)
      .maybeSingle();
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

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
    const rewardMiles = toMilesUnits(validation.result.rewardMiles);
    const rewardStable = toStableUnits(validation.result.rewardStable);
    const score = BigInt(validation.result.score);
    const numericSessionId = BigInt(sessionId);
    const chainGameType = GAME_TYPE_ID[gameType];
    const digest = buildSettlementDigest({
      sessionId: numericSessionId,
      player: walletAddress,
      gameType: chainGameType,
      score,
      rewardMiles,
      rewardStable,
      expiry,
      verifyingContract: skillGamesAddress,
    });
    const wallet = new Wallet(verifierPk, provider);
    const signature = await wallet.signMessage(getBytes(digest));
    const settlement: SettlementPayload = {
      sessionId,
      player: walletAddress,
      gameType,
      score: validation.result.score,
      rewardMiles: validation.result.rewardMiles,
      rewardStable: validation.result.rewardStable,
      expiry: Number(expiry),
      signature,
      digest,
    };

    void (async () => {
      try {
        const contract = getSkillGames(false);
        const tx = await contract.settleGame(numericSessionId, score, rewardMiles, rewardStable, expiry, signature);
        await tx.wait(1);
        await supabase.from("skill_game_sessions").update({ settle_tx_hash: tx.hash }).eq("session_id", sessionId);
      } catch (err) {
        console.error("[games/verify] background settlement failed", err);
      }
    })();

    res.json({ accepted: true, antiAbuseFlags: validation.flags, result: validation.result, settlement, settled: false });
  } catch (err: any) {
    console.error("[games/verify]", err);
    res.status(500).json({ accepted: false, error: err?.message ?? "server-error" });
  }
});

export default router;
