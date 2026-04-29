/**
 * POST /api/games/verify
 *
 * Server-side replay verifier + settlement signer + on-chain settler.
 *
 * After validating the replay the backend now calls settleGame() itself
 * using the verifier private key, removing the settlement transaction from
 * the user entirely (Recommended Rollout step 1).
 *
 * Body: { gameType, sessionId, walletAddress, replay }
 * Returns: VerifierResponse + { settled, settleTxHash? }
 */

import { NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient,
  http, keccak256, encodeAbiParameters, parseAbiParameters, toHex,
  parseAbiItem,
} from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { validateRuleTapReplay, validateMemoryFlipReplay, seedCommitment as computeSeedCommitment } from "@/lib/games/replay-validation";
import { GAME_CONFIGS } from "@/lib/games/config";
import { akibaSkillGamesAbi, AKIBA_SKILL_GAMES_ADDRESS, SETTLEMENT_TYPEHASH_PREIMAGE } from "@/lib/games/contracts";
import { createClient } from "@supabase/supabase-js";
import type {
  GameType, GameReplay, RuleTapReplay, MemoryFlipReplay,
  SettlementPayload, VerifierResponse,
} from "@/lib/games/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const SKILL_GAMES_ADDRESS = AKIBA_SKILL_GAMES_ADDRESS;
const VERIFIER_PK         = process.env.SKILL_GAMES_VERIFIER_PK as `0x${string}` | undefined;
const CELO_RPC            = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_CHAIN_ID       = 42220;

const SETTLEMENT_TYPEHASH = keccak256(toHex(SETTLEMENT_TYPEHASH_PREIMAGE));

function buildSettlementDigest(
  sessionId: bigint, player: `0x${string}`, gameType: number,
  score: bigint, rewardMiles: bigint, rewardStable: bigint,
  expiry: bigint, verifyingContract: `0x${string}`, chainId: bigint
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32,uint256,address,uint8,uint256,uint256,uint256,uint256,address,uint256"),
      [SETTLEMENT_TYPEHASH, sessionId, player, gameType, score, rewardMiles, rewardStable, expiry, verifyingContract, chainId]
    )
  );
}

// DB stores display units (e.g. 6 Miles). Contract expects 1e18 scaled units.
function toMilesUnits(miles: number): bigint {
  return BigInt(Math.round(miles)) * BigInt(10 ** 18);
}
// DB stores display USD (e.g. 0.5). Contract expects USDT 6-decimal units.
function toStableUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

const GAME_TYPE_ID: Record<GameType, number> = { rule_tap: 1, memory_flip: 2 };

const BLOCKING_FLAGS = [
  "impossible_completion_time",
  "non_monotonic_action_log",
  "input_during_pair_evaluation_lock",
];

const GAME_STARTED_EVENT = parseAbiItem(
  "event GameStarted(uint256 indexed sessionId, address indexed player, uint8 indexed gameType, uint256 entryCost, bytes32 seedCommitment)"
);

async function resolveOnchainSeedCommitment(
  publicClient: ReturnType<typeof createPublicClient>,
  sessionId: bigint,
): Promise<`0x${string}` | null> {
  try {
    const logs = await publicClient.getLogs({
      address: SKILL_GAMES_ADDRESS,
      event:   GAME_STARTED_EVENT,
      args:    { sessionId },
      fromBlock: "earliest",
      toBlock:   "latest",
    });
    if (logs.length === 0) return null;
    return (logs[0].args as any).seedCommitment as `0x${string}`;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { gameType, sessionId, walletAddress, replay } = body as {
      gameType: GameType;
      sessionId: string;
      walletAddress: string;
      replay: GameReplay;
    };

    if (!gameType || !sessionId || !walletAddress || !replay) {
      return NextResponse.json({ accepted: false, error: "missing-fields" }, { status: 400 });
    }

    // ── 1. Daily cap (Supabase belt-and-suspenders over on-chain cap) ────────
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from("skill_game_sessions")
      .select("*", { count: "exact", head: true })
      .eq("wallet_address", walletAddress.toLowerCase())
      .eq("game_type", gameType)
      .gte("created_at", `${today}T00:00:00Z`);

    const config = GAME_CONFIGS[gameType];
    if ((count ?? 0) > config.dailyPlayCap) {
      return NextResponse.json({
        accepted: false,
        antiAbuseFlags: ["daily_cap_exceeded"],
        result: { sessionId, gameType, score: 0, mistakes: 0, completed: false, elapsedMs: 0, rewardMiles: 0, rewardStable: 0 },
        settled: false,
      });
    }

    // ── 2. Seed integrity — replay.seed must hash to the on-chain commitment ──
    if (SKILL_GAMES_ADDRESS) {
      const replaySeed = (replay as any).seed as string | undefined;
      if (!replaySeed) {
        return NextResponse.json({ accepted: false, error: "missing-seed" }, { status: 400 });
      }

      // Check Supabase first (faster — set by sponsored-start path)
      const { data: sessionRow } = await supabase
        .from("skill_game_sessions")
        .select("seed_commitment")
        .eq("session_id", sessionId)
        .maybeSingle();

      let expectedCommitment: `0x${string}` | null = sessionRow?.seed_commitment ?? null;

      // Fall back to on-chain event for self-start sessions
      if (!expectedCommitment) {
        const publicClientForSeed = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
        expectedCommitment = await resolveOnchainSeedCommitment(publicClientForSeed, BigInt(sessionId));
      }

      if (expectedCommitment) {
        const actualCommitment = computeSeedCommitment(replaySeed, walletAddress, gameType);
        if (actualCommitment.toLowerCase() !== expectedCommitment.toLowerCase()) {
          return NextResponse.json({ accepted: false, error: "seed-commitment-mismatch" }, { status: 400 });
        }
      }
      // If we cannot resolve the commitment (no DB row, no chain event) we still
      // proceed — this can happen in dev or if the chain is unreachable. The
      // remaining anti-abuse checks still apply.
    }

    // ── 3. Replay validation ─────────────────────────────────────────────────
    const validation =
      gameType === "rule_tap"
        ? validateRuleTapReplay(replay as RuleTapReplay)
        : validateMemoryFlipReplay(replay as MemoryFlipReplay);

    const accepted = !validation.flags.some((f) => BLOCKING_FLAGS.includes(f));

    // ── 4. Persist session ───────────────────────────────────────────────────
    await supabase.from("skill_game_sessions").upsert({
      session_id:       sessionId,
      wallet_address:   walletAddress.toLowerCase(),
      game_type:        gameType,
      score:            validation.result.score,
      reward_miles:     accepted ? validation.result.rewardMiles : 0,
      reward_stable:    accepted ? validation.result.rewardStable : 0,
      accepted,
      anti_abuse_flags: validation.flags,
      created_at:       new Date().toISOString(),
    });

    if (!accepted) {
      return NextResponse.json({
        accepted: false,
        antiAbuseFlags: validation.flags,
        result: { ...validation.result, rewardMiles: 0, rewardStable: 0 },
        settled: false,
      });
    }

    // ── 5. No contract configured — accepted but no chain settlement ─────────
    if (!VERIFIER_PK || !SKILL_GAMES_ADDRESS) {
      return NextResponse.json({
        accepted: true,
        antiAbuseFlags: validation.flags,
        result: validation.result,
        settlement: null,
        settled: false,
      });
    }

    // ── 6. Build settlement payload ──────────────────────────────────────────
    const expiry        = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
    const rewardMiles   = toMilesUnits(validation.result.rewardMiles);
    const rewardStable  = toStableUnits(validation.result.rewardStable);
    const score         = BigInt(validation.result.score);
    const numericSID    = BigInt(sessionId);
    const chainGameType = GAME_TYPE_ID[gameType];

    const digest = buildSettlementDigest(
      numericSID, walletAddress as `0x${string}`, chainGameType,
      score, rewardMiles, rewardStable, expiry,
      SKILL_GAMES_ADDRESS, BigInt(CELO_CHAIN_ID)
    );

    const account   = privateKeyToAccount(VERIFIER_PK);
    const signature = await account.signMessage({ message: { raw: digest } });

    const settlement: SettlementPayload = {
      sessionId,
      player:       walletAddress as `0x${string}`,
      gameType,
      score:        validation.result.score,
      rewardMiles:  validation.result.rewardMiles,
      rewardStable: validation.result.rewardStable,
      expiry:       Number(expiry),
      signature,
      digest,
    };

    // ── 7. Backend settles on-chain — user pays zero gas for settlement ───────
    let settleTxHash: string | undefined;
    let settled = false;
    try {
      const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
      const walletClient = createWalletClient({ chain: celo, transport: http(CELO_RPC), account });

      const hash = await walletClient.writeContract({
        chain: celo,
        account,
        address: SKILL_GAMES_ADDRESS,
        abi: akibaSkillGamesAbi,
        functionName: "settleGame",
        args: [numericSID, score, rewardMiles, rewardStable, expiry, signature],
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      settleTxHash = hash;
      settled      = true;

      await supabase
        .from("skill_game_sessions")
        .update({ settle_tx_hash: hash })
        .eq("session_id", sessionId);
    } catch (chainErr) {
      // Chain settlement failed — return signed payload so client can retry via settleGame()
      console.error("[games/verify] on-chain settle failed:", chainErr);
    }

    return NextResponse.json({
      accepted: true,
      antiAbuseFlags: validation.flags,
      result:     validation.result,
      settlement,
      settled,
      settleTxHash,
    } satisfies VerifierResponse & { settled: boolean; settleTxHash?: string });
  } catch (err) {
    console.error("[games/verify] error", err);
    return NextResponse.json({ accepted: false, error: "server-error" }, { status: 500 });
  }
}
